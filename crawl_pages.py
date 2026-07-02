"""
Playwright を使ってページをクロールするサンプル。
トップページの href リンクを1階層だけ辿り、別ファイルへ保存します。

【インストール(初回のみ)】
    pip install -r requirements.txt
    playwright install chromium

【使い方】
    python crawl_github.py
    python crawl_github.py --url https://example.com --manual-consent

【出力】
    output/github_crawl4ai.md
    output/github_crawl4ai.html
    output/github_crawl4ai_meta.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin
from urllib.parse import urldefrag
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://github.com/unclecode/crawl4ai"
OUTPUT_DIR = Path(__file__).parent / "output"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="トップページと1階層メニューリンクをクロールして保存します"
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=None,
        help="クロールするトップページURL(位置引数)",
    )
    parser.add_argument(
        "--url",
        dest="url_option",
        default=None,
        help="クロールするトップページURL(--url 形式)",
    )
    parser.add_argument(
        "--manual-consent",
        action="store_true",
        help="ブラウザを表示して手動で同意ボタンをクリックしてからクロールする",
    )
    parser.add_argument(
        "--output-dir",
        dest="output_dir",
        default=None,
        help="出力先ディレクトリ（省略時は output/ を使用）",
    )
    return parser.parse_args()


def _slug(text: str, max_len: int = 80) -> str:
    """URLやタイトルをファイル名として安全な形にする。"""
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", text).strip("_")
    return s[:max_len] if s else "page"


def _url_to_file_prefix(url: str, max_len: int = 100) -> str:
    """URL のドメイン+パスをファイル名プレフィックスに変換する。
    例: https://example.com/aaa/bbb.html -> example.com_aaa_bbb
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "unknown").lower()
    path = parsed.path.rstrip("/")
    # 拡張子を除去
    path = re.sub(r"\.[a-zA-Z]{2,5}$", "", path)
    combined = host + path
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", combined).strip("_")
    return safe[:max_len] if safe else "page"


def _to_markdown_text(html: str) -> str:
    """簡易的に HTML から可読テキストを作る。"""
    soup = BeautifulSoup(html, "html.parser")
    texts = [re.sub(r"\s+", " ", t.strip()) for t in soup.stripped_strings if t.strip()]
    return "\n".join(texts)


def _extract_level1_links(html: str, base_url: str) -> list[dict]:
    """header/nav と nav系 div 配下の href を収集し、1階層候補リンクを返す。"""
    soup = BeautifulSoup(html, "html.parser")
    base_parsed = urlparse(base_url)
    base_host = (base_parsed.hostname or "").lower()
    base_path = base_parsed.path or "/"
    if not base_path.startswith("/"):
        base_path = f"/{base_path}"
    # 開始URLの1つ上の階層を探索対象の基準にする。
    # 例: /aaa/aaa を指定した場合は /aaa/ 配下を許可し、/aaa/bbb も対象にする。
    parent_path = str(Path(base_path).parent).replace("\\", "/")
    if not parent_path.startswith("/"):
        parent_path = f"/{parent_path}"
    if parent_path in ("", "."):
        parent_path = "/"
    if parent_path != "/" and not parent_path.endswith("/"):
        parent_prefix = f"{parent_path}/"
    else:
        parent_prefix = parent_path
    links: list[dict] = []
    seen: set[str] = set()

    containers = soup.find_all(["header", "nav"])
    for div in soup.find_all("div"):
        div_id = str(div.get("id") or "").lower()
        div_classes = " ".join(div.get("class") or []).lower()
        if any(key in div_id or key in div_classes for key in ("header", "navi", "nav")):
            containers.append(div)

    anchors = []
    for container in containers:
        anchors.extend(container.find_all("a", href=True))

    for a in anchors:
        href = (a.get("href") or "").strip()
        if not href:
            continue
        abs_url = urljoin(base_url, href)
        abs_url, _ = urldefrag(abs_url)
        parsed = urlparse(abs_url)
        host = (parsed.hostname or "").lower()

        if parsed.scheme not in ("http", "https"):
            continue
        # 指定したドメインと完全一致のみ許可(下位/上位ドメインは除外)
        if not host:
            continue
        if host != base_host:
            continue
        candidate_path = parsed.path or "/"
        if not candidate_path.startswith("/"):
            candidate_path = f"/{candidate_path}"
        # 開始URLの1つ上の階層より上位には遷移しない(親階層配下のみ許可)
        if parent_path != "/" and candidate_path != parent_path.rstrip("/") and not candidate_path.startswith(parent_prefix):
            continue
        if abs_url in seen:
            continue

        label = re.sub(r"\s+", " ", a.get_text(" ")).strip()
        if not label:
            label = abs_url

        seen.add(abs_url)
        links.append({"label": label, "href": href, "url": abs_url})

    return links


def _get_selector(el) -> str:
    """要素の CSS セレクタを生成する（id 優先 → class → 属性 → 親+nth-child）。"""
    el_id = (el.get("id") or "").strip()
    if el_id:
        return f"#{el_id}"

    tag = el.name
    classes = [str(c) for c in (el.get("class") or []) if str(c).strip()]
    if classes:
        return f"{tag}.{'.' .join(classes[:3])}"

    for attr in ("name", "role", "type", "placeholder", "href"):
        val = (el.get(attr) or "").strip()
        if val:
            safe = val.replace("'", "\\'")
            return f"{tag}[{attr}='{safe}']"

    parent = el.parent
    if parent and getattr(parent, "name", None) and parent.name not in ("html", "body", "[document]"):
        parent_id = (parent.get("id") or "").strip()
        siblings = [s for s in parent.find_all(tag, recursive=False)]
        try:
            idx = siblings.index(el) + 1
        except ValueError:
            idx = 1
        if parent_id:
            return f"#{parent_id} > {tag}:nth-child({idx})"
        parent_classes = [str(c) for c in (parent.get("class") or []) if str(c).strip()]
        if parent_classes:
            return f"{parent.name}.{parent_classes[0]} > {tag}:nth-child({idx})"
    return tag


def _get_label_text(el, soup) -> str:
    """input/button に対応する label テキストを返す。"""
    el_id = (el.get("id") or "").strip()
    if el_id:
        label = soup.find("label", {"for": el_id})
        if label:
            return label.get_text(" ", strip=True)
    parent = el.parent
    if parent and getattr(parent, "name", None) == "label":
        return parent.get_text(" ", strip=True)
    return ""


def _extract_selector_info(html: str, page_url: str) -> dict:
    """
    guide-patterns.json の selector フィールド生成に必要な要素情報を抽出する。
    出力カテゴリ:
      headings / interactive_elements / links / forms / tables / navigation
    """
    soup = BeautifulSoup(html, "html.parser")

    def data_attrs(el) -> dict:
        return {k: v for k, v in (el.attrs or {}).items() if k.startswith("data-")}

    # --- 見出し（H1〜H3）---
    headings = []
    for level in (1, 2, 3):
        for h in soup.find_all(f"h{level}"):
            headings.append({
                "level": level,
                "text": h.get_text(" ", strip=True),
                "id": h.get("id", ""),
                "classes": [str(c) for c in (h.get("class") or [])],
                "selector": _get_selector(h),
            })

    # --- インタラクティブ要素（button / input / select / textarea）---
    interactive = []
    for el in soup.find_all(["button", "input", "select", "textarea"]):
        interactive.append({
            "tag": el.name,
            "id": el.get("id", ""),
            "classes": [str(c) for c in (el.get("class") or [])],
            "type": el.get("type", ""),
            "name": el.get("name", ""),
            "placeholder": el.get("placeholder", ""),
            "value": el.get("value", "") if el.name in ("input", "button") else "",
            "text": el.get_text(" ", strip=True),
            "role": el.get("role", ""),
            "data_attrs": data_attrs(el),
            "label": _get_label_text(el, soup),
            "selector": _get_selector(el),
        })

    # --- リンク（<a href>）---
    links_info = []
    for a in soup.find_all("a", href=True):
        links_info.append({
            "tag": "a",
            "id": a.get("id", ""),
            "classes": [str(c) for c in (a.get("class") or [])],
            "href": a.get("href", ""),
            "text": a.get_text(" ", strip=True),
            "role": a.get("role", ""),
            "data_attrs": data_attrs(a),
            "selector": _get_selector(a),
        })

    # --- フォーム ---
    forms_info = []
    for form in soup.find_all("form"):
        fields = []
        for el in form.find_all(["input", "select", "textarea", "button"]):
            fields.append({
                "tag": el.name,
                "id": el.get("id", ""),
                "name": el.get("name", ""),
                "type": el.get("type", ""),
                "placeholder": el.get("placeholder", ""),
                "classes": [str(c) for c in (el.get("class") or [])],
                "role": el.get("role", ""),
                "data_attrs": data_attrs(el),
                "label": _get_label_text(el, soup),
                "selector": _get_selector(el),
            })
        forms_info.append({
            "id": form.get("id", ""),
            "classes": [str(c) for c in (form.get("class") or [])],
            "action": form.get("action", ""),
            "method": form.get("method", "get").upper(),
            "selector": _get_selector(form),
            "fields": fields,
        })

    # --- テーブル ---
    tables_info = []
    for table in soup.find_all("table"):
        headers = [th.get_text(" ", strip=True) for th in table.find_all("th")]
        tbody = table.find("tbody")
        data_rows = len(tbody.find_all("tr")) if tbody else 0
        tables_info.append({
            "id": table.get("id", ""),
            "classes": [str(c) for c in (table.get("class") or [])],
            "selector": _get_selector(table),
            "headers": headers,
            "data_row_count": data_rows,
        })

    # --- ナビゲーション（nav / header 内リンク）---
    nav_info = []
    for nav in soup.find_all(["nav", "header"]):
        items = [
            {
                "text": a.get_text(" ", strip=True),
                "href": a.get("href", ""),
                "selector": _get_selector(a),
            }
            for a in nav.find_all("a", href=True)
        ]
        if items:
            nav_info.append({
                "tag": nav.name,
                "id": nav.get("id", ""),
                "classes": [str(c) for c in (nav.get("class") or [])],
                "selector": _get_selector(nav),
                "items": items,
            })

    return {
        "url": page_url,
        "headings": headings,
        "interactive_elements": interactive,
        "links": links_info,
        "forms": forms_info,
        "tables": tables_info,
        "navigation": nav_info,
    }


def _crawl_single_page(page, url: str) -> dict:
    """1ページを取得してタイトルと HTML を返す。"""
    page.goto(url, wait_until="networkidle", timeout=60_000)
    page.wait_for_timeout(800)
    return {
        "url": page.url,
        "title": page.title(),
        "html": page.content(),
    }

def crawl(target_url: str, manual_consent: bool = False) -> dict:
    print(f"[..] クロール中: {target_url}")
    try:
        from playwright.sync_api import sync_playwright as _check
    except ImportError:
        raise RuntimeError(
            "Playwright がインストールされていません。\n"
            "  pip install playwright\n"
            "  playwright install chromium\n"
            "を実行してください。"
        )

    with sync_playwright() as pw:
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",                # WSL/コンテナ環境で必須
            "--disable-dev-shm-usage",     # WSL の /dev/shm が小さい問題を回避
            "--disable-gpu",               # WSLg で GPU レンダリングが不安定な場合に回避
            "--start-maximized",           # ウィンドウを最大化して確実に前面表示
        ]
        try:
            browser = pw.chromium.launch(
                headless=not manual_consent,
                args=launch_args,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Chromium の起動に失敗しました: {exc}\n"
                "playwright install chromium を実行してください。"
            ) from exc
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            java_script_enabled=True,
        )
        # navigator.webdriver を隠してサイト側のボタン無効化・ガイド強制表示を防ぐ
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = context.new_page()

        if manual_consent:
            print("[WAIT] ページ読み込み中...")
            # networkidle まで待つことで React/SPA のボタンが確実に有効になる
            page.goto(target_url, wait_until="networkidle", timeout=60_000)
            page.bring_to_front()
            page.wait_for_timeout(3000)  # SPA の localStorage 初期化まで追加待機
            print("[WAIT] 準備完了。ブラウザでガイド選択・同意ボタンを操作してください。")
            print(f"[INFO] URL: {target_url}")
            print("[INFO] ブラウザが見えない場合: タスクバーまたは Alt+Tab で 'Chromium' を探してください。")
            input("[INPUT] 操作完了後、Enter を押すとクロールを開始します: ")

        top_page = _crawl_single_page(page, target_url)
        html = top_page["html"]
        title = top_page["title"]
        url = top_page["url"]

        level1_links = _extract_level1_links(html, url)
        level1_pages: list[dict] = []
        total_links = len(level1_links)
        print(f"[..] 1階層リンク数: {total_links}")

        for idx, link in enumerate(level1_links, start=1):
            print(f"    [{idx}/{total_links}] 取得中: {link['url']}")
            try:
                child = _crawl_single_page(page, link["url"])
                child_md = _to_markdown_text(child["html"])
                level1_pages.append(
                    {
                        "source": link,
                        "url": child["url"],
                        "title": child["title"],
                        "html": child["html"],
                        "markdown": child_md,
                    }
                )
            except Exception as exc:
                level1_pages.append(
                    {
                        "source": link,
                        "url": link["url"],
                        "title": "",
                        "html": "",
                        "markdown": "",
                        "error": str(exc),
                    }
                )
        browser.close()

    md = _to_markdown_text(html)
    links = [
        {"label": item["label"], "href": item["href"], "url": item["url"]}
        for item in level1_links
    ]
    selector_info = _extract_selector_info(html, url)
    for item in level1_pages:
        if item.get("html"):
            item["selector_info"] = _extract_selector_info(item["html"], item["url"])
    return {
        "url": url,
        "title": title,
        "html": html,
        "markdown": md,
        "links": links,
        "selector_info": selector_info,
        "level1_pages": level1_pages,
    }


def save(data: dict, output_dir: Path | None = None) -> None:
    dest = Path(output_dir) if output_dir else OUTPUT_DIR
    dest.mkdir(parents=True, exist_ok=True)
    prefix = _url_to_file_prefix(data["url"])

    (dest / f"{prefix}.html").write_text(data["html"],     encoding="utf-8")
    (dest / f"{prefix}.md"  ).write_text(data["markdown"], encoding="utf-8")
    meta = {"url": data["url"], "title": data["title"], "links": data["links"]}
    (dest / f"{prefix}_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # トップページの selector_info を保存
    (dest / f"{prefix}_selector_info.json").write_text(
        json.dumps(data.get("selector_info", {}), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    level1_index: list[dict] = []
    for idx, item in enumerate(data.get("level1_pages", []), start=1):
        source = item.get("source", {})
        child_prefix = _url_to_file_prefix(item.get("url") or "")
        base_name = f"menu_{idx:03d}_{child_prefix}"
        html_name = f"{base_name}.html"
        md_name   = f"{base_name}.md"
        si_name   = f"{base_name}_selector_info.json"
        if item.get("html"):
            (dest / html_name).write_text(item["html"], encoding="utf-8")
        if item.get("markdown"):
            (dest / md_name).write_text(item["markdown"], encoding="utf-8")
        if item.get("selector_info"):
            (dest / si_name).write_text(
                json.dumps(item["selector_info"], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        level1_index.append(
            {
                "index": idx,
                "label": source.get("label", ""),
                "source_href": source.get("href", ""),
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "error": item.get("error", ""),
                "html_file": html_name if item.get("html") else "",
                "markdown_file": md_name if item.get("markdown") else "",
                "selector_info_file": si_name if item.get("selector_info") else "",
            }
        )

    (dest / f"{prefix}_level1_menu.json").write_text(
        json.dumps(level1_index, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"[OK] 保存しました -> {dest}")
    print(f"     プレフィックス: {prefix}")
    print(f"     - {prefix}.md    ({len(data['markdown']):,} 文字)")
    print(f"     - {prefix}.html  ({len(data['html']):,} 文字)")
    print(f"     - {prefix}_meta.json")
    print(f"     - {prefix}_selector_info.json")
    print(f"     - {prefix}_level1_menu.json")
    print(f"     - menu_* ファイル ({len(level1_index)}件、各 _selector_info.json 含む)")
    print(f"\n     タイトル: {data['title']}")
    print("\n--- Markdown プレビュー(先頭500文字) ---")
    print(data["markdown"][:500])
    print("---")


if __name__ == "__main__":
    args = _parse_args()
    target_url = args.url_option or args.url or DEFAULT_URL
    save(crawl(target_url, manual_consent=args.manual_consent), output_dir=args.output_dir)
