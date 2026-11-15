import pytest

from app.errors import AppError
from app.learning.problem_parts import selected_subquestion, split_problem


def test_splits_markdown_parts_without_splitting_code_or_inline_numbers():
    problem = """共用信息（1）是编号。

```text
(1) 行号
```

**（１）** 用 $x$ 写出定义。

给出理由。
（2）说明结论。"""
    assert split_problem(problem) == {
        "statement": "共用信息（1）是编号。\n\n```text\n(1) 行号\n```",
        "parts": [
            {"number": 1, "text": "用 $x$ 写出定义。\n\n给出理由。"},
            {"number": 2, "text": "说明结论。"},
        ],
    }
    assert selected_subquestion(problem, 2)["text"] == "说明结论。"
    with pytest.raises(AppError, match="小题"):
        selected_subquestion(problem, 3)


@pytest.mark.parametrize("problem", ["求 f(2)。", "（1）求值。", "（1）讨论。\n（3）验证。"])
def test_unstructured_problem_stays_whole(problem):
    assert split_problem(problem) is None
