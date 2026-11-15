QUESTION_ACTIONS = {
    "start",
    "custom-question",
    "similar-question",
    "select-type",
    "next-type",
    "next-question",
}


def next_type(practice):
    current = practice["current"]
    mastered = practice["mastered"]
    order = range(current + 1, len(practice["types"])), range(current)
    return next((index for indexes in order for index in indexes if index not in mastered), None)


def practice_actions(practice, status, has_parts):
    if practice and practice["finished"]:
        return []
    if practice and len(practice["mastered"]) == len(practice["types"]):
        return ["finish"]
    actions = ["custom-question", "similar-question"]
    if practice and len(practice["types"]) > 1:
        actions.append("select-type")
    if not practice or next_type(practice) is not None:
        actions.append("next-type")
    if (
        practice
        and has_parts
        and status != "completed"
        and practice["current"] not in practice["mastered"]
    ):
        actions.append("master-type")
    return actions


def mark_mastered(practice):
    return {**practice, "mastered": sorted({*practice["mastered"], practice["current"]})}
