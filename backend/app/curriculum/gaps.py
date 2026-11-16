import re
from copy import deepcopy
from unicodedata import normalize
from uuid import uuid4

from app.curriculum.contracts import (
    ChapterSupplement,
    CurriculumInput,
    GapLocation,
    SectionSupplement,
)
from app.curriculum.extraction import is_exercise_solution, without_exercise_solutions
from app.errors import AppError

PRINTED_NUMBER = re.compile(
    r"^(?:第\s*[\d一二三四五六七八九十百零〇两]+\s*[章节篇部]\s*[:、.]?\s*"
    r"|§\s*\d+(?:\.\d+)*\s*|\d+(?:\.\d+)*(?:\s+|[、:]\s*))"
)


def position(chapters, location):
    """Resolve an insertion point using draft IDs, independent of display numbering."""
    parent_id, after_id = location["chapter_id"], location["after_id"]
    parent = next((chapter for chapter in chapters if chapter["id"] == parent_id), None)
    if parent_id is not None and parent is None:
        raise ValueError("Gap chapter is missing")
    siblings = chapters if parent is None else parent["sections"]
    if after_id is None:
        return parent, siblings, 0
    for index, node in enumerate(siblings):
        if node["id"] == after_id:
            return parent, siblings, index + 1
    raise ValueError("Gap anchor is missing")


def attach_gap_hints(extracted):
    payload = {key: value for key, value in extracted.items() if key != "gaps"}
    review = list(payload.get("uncertain_items", []))
    gaps = []
    seen = set()
    for hint in extracted.get("gaps", []):
        try:
            location = GapLocation.model_validate(hint).model_dump()
            position(payload["chapters"], location)
        except ValueError:
            # An anchor can disappear when exercise solutions are filtered.
            if hint["reason"] not in review and len(review) < 100:
                review.append(hint["reason"])
            continue
        key = (location["chapter_id"], location["after_id"])
        if key not in seen:
            seen.add(key)
            gaps.append({**location, "id": uuid4().hex})
    return CurriculumInput.model_validate(
        {**payload, "gaps": gaps, "uncertain_items": review}
    ).draft_payload()


def get_gap(payload, gap_id):
    for gap in payload.get("gaps", []):
        if gap["id"] == gap_id:
            return gap
    raise AppError("VERSION_CONFLICT", "该空位已处理，请重新加载目录", 409)


def _heading(node):
    return {key: node.get(key) for key in ("title", "page_start", "page_end")} if node else None


def gap_context(payload, gap):
    parent, siblings, index = position(payload["chapters"], gap)
    return {
        "reason": gap["reason"],
        "level": "sections" if parent else "chapters",
        "chapter": _heading(parent),
        "preceding": [_heading(node) for node in siblings[max(0, index - 2) : index]],
        "following": [_heading(node) for node in siblings[index : index + 2]],
    }


def _title(node):
    title = normalize("NFKC", node["title"]).strip()
    return "".join(PRINTED_NUMBER.sub("", title).split()).casefold()


def _already_present(item, nodes):
    title, page = _title(item), item.get("page_start")
    return any(
        title == _title(node) and (page is None or node.get("page_start") in (None, page))
        for node in nodes
    )


def _new_node(node):
    copy = {**node, "id": f"tmp-{uuid4()}"}
    if "sections" in node:
        copy["sections"] = [_new_node(section) for section in node["sections"]]
    return copy


def fill_gap(saved, gap_id, structured):
    payload = deepcopy(saved)
    gap = get_gap(payload, gap_id)
    parent, siblings, index = position(payload["chapters"], gap)
    result_type = SectionSupplement if parent else ChapterSupplement
    result = result_type.model_validate(structured)
    if not result.complete:
        raise AppError("GAP_INCOMPLETE", "照片未覆盖此空位，请补拍对应的目录页", 422)
    items = [node.model_dump() for node in result.items]
    if parent:
        items = [node for node in items if not is_exercise_solution(node["title"])]
    else:
        items = without_exercise_solutions({"chapters": items})["chapters"]
    lower = siblings[index - 1].get("page_start") if index else None
    upper = siblings[index].get("page_start") if index < len(siblings) else None
    added = []
    for item in items:
        if _already_present(item, siblings) or _already_present(item, added):
            continue
        page = item.get("page_start")
        if page is not None and (
            (lower is not None and page < lower) or (upper is not None and page > upper)
        ):
            raise AppError("GAP_RANGE", "识别到的页码不在此空位范围内，请检查照片", 422)
        added.append(_new_node(item))
    if not added:
        raise AppError("GAP_EMPTY", "这张照片没有识别到此空位的新目录条目", 422)
    siblings[index:index] = added
    payload["gaps"] = [item for item in payload["gaps"] if item["id"] != gap_id]
    if not payload["gaps"]:
        del payload["gaps"]
    if result.uncertain_items:
        payload["uncertain_items"] = list(
            dict.fromkeys([*payload.get("uncertain_items", []), *result.uncertain_items])
        )
    CurriculumInput.model_validate(payload)
    return payload
