import re

from app.errors import AppError

PART = re.compile(r"^[ \t]{0,3}(?:\*\*)?[（(]([1-9１-９][0-9０-９]?)[）)](?:\*\*)?[ \t]*(.*)$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def split_problem(problem):
    lines = problem.splitlines()
    markers = []
    fence = None
    math_block = False
    for index, line in enumerate(lines):
        if (delimiter := FENCE.match(line)) and not math_block:
            token, rest = delimiter.groups()
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not rest.strip():
                fence = None
            continue
        if fence is not None:
            continue
        if line.strip() == "$$":
            math_block = not math_block
            continue
        if not math_block and (marker := PART.match(line)):
            markers.append((index, int(marker[1]), marker[2]))
    if len(markers) < 2 or [number for _, number, _ in markers] != list(range(1, len(markers) + 1)):
        return None
    parts = []
    ends = [index for index, _, _ in markers[1:]] + [len(lines)]
    for (index, number, first), end in zip(markers, ends, strict=True):
        text = "\n".join([first, *lines[index + 1 : end]]).strip()
        if not text:
            return None
        parts.append({"number": number, "text": text})
    return {"statement": "\n".join(lines[: markers[0][0]]).strip(), "parts": parts}


def problem_fields(problem):
    parts = split_problem(problem) if problem else None
    return {"problem_parts": parts} if parts else {}


def selected_subquestion(problem, number):
    if number is None:
        return None
    parsed = split_problem(problem)
    if parsed is None or not 1 <= number <= len(parsed["parts"]):
        raise AppError("INVALID_SUBQUESTION", "小题已变化，请重新选择")
    return parsed["parts"][number - 1]
