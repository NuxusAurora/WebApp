import re
from unicodedata import normalize

HEADING_PREFIX = re.compile(
    r"^(?:第[0-9一二三四五六七八九十百零〇两]+(?:[章节篇]|部分)"
    r"|附录[0-9A-Z一二三四五六七八九十百零〇两]*|§?\d+(?:\.\d+)*)[.、:\-]?"
)
EXERCISE_SOLUTION = re.compile(
    r"(?:课后|各章|本章)?(?:习题|练习题|复习题)[0-9一二三四五六七八九十]*"
    r"(?:全解|详解|解答|参考答案|答案)(?:\((?:上册|下册)\))?"
)


def is_exercise_solution(title: str) -> bool:
    heading = "".join(normalize("NFKC", title).split()).removesuffix("[待核对]")
    heading = HEADING_PREFIX.sub("", heading)
    for opening, closing in ("()", "[]", "【】"):
        if heading.startswith(opening) and heading.endswith(closing):
            heading = heading[1:-1]
            break
    return EXERCISE_SOLUTION.fullmatch(heading) is not None


def without_exercise_solutions(structured: dict) -> dict:
    chapters = [
        {
            **chapter,
            "sections": [
                section
                for section in chapter["sections"]
                if not is_exercise_solution(section["title"])
            ],
        }
        for chapter in structured["chapters"]
        if not is_exercise_solution(chapter["title"])
    ]
    return {**structured, "chapters": chapters}
