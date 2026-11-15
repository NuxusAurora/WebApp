from datetime import UTC, datetime
from uuid import uuid4

import pytest
from jsonschema import ValidationError as SchemaError
from pydantic import ValidationError

from app.ai.gateway import schema_validator
from app.learning.contracts import (
    LessonOperation,
    LessonPlan,
    LessonPlanDraft,
    NewQuestionOutput,
    StepOutput,
    model_output_schema,
    operation_output_schema,
    validate_model_output,
)

PRACTICE_TYPES = {
    "types": [
        {"title": "判断对应关系", "objective": "从定义判断是否为函数"},
        {"title": "区分函数与关系", "objective": "用反例说明区别"},
    ]
}


@pytest.fixture
def draft_data():
    return {
        "learning_objective": "判断给出的数是不是函数的输入。",
        "prerequisite_knowledge": [],
        "problem": "已知 f(x)=2x+1，求 f(3)。",
        "difficulty": "beginner",
        "steps": [
            {
                "index": 1,
                "objective": "识别输入",
                "concept": "函数记号",
                "required_context": [],
                "completion_criteria": ["能说明 3 在这里代表输入"],
                "common_mistakes": ["把输入当作输出"],
                "forbidden": [],
                "expected_takeaway": "括号标出输入。",
            }
        ],
        "reference_answer": "7",
    }


def test_one_step_and_longer_plans_use_same_gateway_contract(draft_data):
    schema = schema_validator(model_output_schema(LessonOperation.PLAN))
    for count in (1, 4):
        draft_data["steps"] = [
            {**draft_data["steps"][0], "index": index, "objective": f"目标 {index}"}
            for index in range(1, count + 1)
        ]
        schema.validate(draft_data)
        plan = validate_model_output(LessonOperation.PLAN, draft_data)
        assert isinstance(plan, LessonPlanDraft)
        assert len(plan.steps) == count


@pytest.mark.parametrize("indexes", [[], [0], [2], [1, 1], [1, 3], [2, 1], ["1"], [True]])
def test_rejects_missing_or_discontinuous_steps(draft_data, indexes):
    step = draft_data["steps"][0]
    draft_data["steps"] = [{**step, "index": index} for index in indexes]
    with pytest.raises(ValidationError):
        validate_model_output(LessonOperation.PLAN, draft_data)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("objective", "　\t"),
        ("completion_criteria", []),
        ("forbidden", None),
        ("reference_answer", "   "),
        ("difficulty", "expert"),
        ("prerequisite_knowledge", [""]),
    ],
)
def test_rejects_invalid_teaching_fields(draft_data, field, value):
    if field in draft_data:
        draft_data[field] = value
    else:
        draft_data["steps"][0][field] = value
    with pytest.raises(ValidationError):
        validate_model_output(LessonOperation.PLAN, draft_data)


def test_requires_the_plan_reference_and_step_forbidden_field(draft_data):
    schema = schema_validator(model_output_schema(LessonOperation.PLAN))
    for owner, key in ((draft_data, "reference_answer"), (draft_data["steps"][0], "forbidden")):
        value = owner.pop(key)
        with pytest.raises(SchemaError):
            schema.validate(draft_data)
        with pytest.raises(ValidationError):
            validate_model_output(LessonOperation.PLAN, draft_data)
        owner[key] = value


def test_draft_accepts_only_content_and_persisted_plan_is_deeply_frozen(draft_data):
    metadata = {
        "plan_id": uuid4(),
        "question_id": uuid4(),
        "knowledge_point_id": uuid4(),
        "plan_version": 1,
        "created_at": datetime.now(UTC),
    }
    # The planner can't set identities, creation time, or the plan version.
    for field, value in metadata.items():
        with pytest.raises(ValidationError, match="extra_forbidden"):
            validate_model_output(LessonOperation.PLAN, {**draft_data, field: value})
    plan = LessonPlan.model_validate(draft_data | metadata)
    with pytest.raises(ValidationError, match="frozen_instance"):
        plan.steps[0].objective = "修改目标"
    with pytest.raises(ValidationError, match="frozen_instance"):
        plan.problem = "换题"
    assert plan.steps[0].completion_criteria == ("能说明 3 在这里代表输入",)
    draft_data["steps"][0]["completion_criteria"][0] = "输入列表被外部修改"
    assert plan.steps[0].completion_criteria == ("能说明 3 在这里代表输入",)
    assert LessonPlan.model_validate_json(plan.model_dump_json()) == plan
    for date in ("2026-11-14T12:00:00", "1794679200", 1794679200):
        with pytest.raises(ValidationError):
            LessonPlan.model_validate(draft_data | metadata | {"created_at": date})

    first_step = StepOutput(title="识别输入", content="输入是 3。")
    assert NewQuestionOutput.from_plan(plan, first_step).model_dump() == {
        "problem": plan.problem,
        "title": first_step.title,
        "content": first_step.content,
    }


@pytest.mark.parametrize(
    ("operation", "payload"),
    [
        (
            LessonOperation.START,
            {"problem": "求 f(3)。", "title": "识别输入", "content": "输入是 3。"},
        ),
        (
            LessonOperation.NEXT_QUESTION,
            {"problem": "求 f(3)。", "title": "识别输入", "content": "输入是 3。"},
        ),
        (LessonOperation.NEXT, {"title": "代入", "content": "用 x=3 代入。"}),
        (LessonOperation.REPHRASE, {"text": "换一种理解。"}),
        (LessonOperation.HINT, {"text": "观察括号。"}),
        (LessonOperation.CHECK_QUESTION, {"text": "输入是什么？"}),
        (LessonOperation.CHECK_FEEDBACK, {"text": "回答正确。"}),
        (LessonOperation.ASSISTANT, {"text": "这里只解释当前问题。"}),
    ],
)
def test_operation_wire_schema_rejects_extra_state_and_empty_content(operation, payload):
    gateway = schema_validator(operation_output_schema(operation))
    gateway.validate(payload)
    for extra in ("final", "step_index", "reference_answer"):
        invalid = payload | {extra: True}
        with pytest.raises(SchemaError):
            gateway.validate(invalid)
    required_field = next(iter(payload))
    with pytest.raises(SchemaError):
        gateway.validate({k: v for k, v in payload.items() if k != required_field})
    with pytest.raises(SchemaError):
        gateway.validate(payload | {required_field: " \n　"})

    tutor_payload = {k: v for k, v in payload.items() if k != "problem"}
    model_schema = schema_validator(model_output_schema(operation))
    model_schema.validate(tutor_payload)
    assert validate_model_output(operation, tutor_payload).model_dump(mode="json") == tutor_payload
    if "problem" in payload:
        with pytest.raises(SchemaError):
            model_schema.validate(payload)
        with pytest.raises(ValidationError):
            validate_model_output(operation, payload)
    with pytest.raises(ValidationError):
        validate_model_output(operation, tutor_payload | {"final": True})


def test_next_disallows_replacing_problem_and_completion_has_no_model_output():
    step = {"title": "代入", "content": "代入后计算。"}
    with pytest.raises(ValidationError):
        validate_model_output(LessonOperation.NEXT, step | {"problem": "另一道题"})
    with pytest.raises(ValidationError):
        validate_model_output(LessonOperation.NEXT, step | {"title": "题" * 121})

    completion = schema_validator(operation_output_schema(LessonOperation.COMPLETE))
    completion.validate({"status": "completed"})
    with pytest.raises(SchemaError):
        completion.validate({"status": "teaching"})
    with pytest.raises(ValueError, match="platform"):
        model_output_schema(LessonOperation.COMPLETE)
