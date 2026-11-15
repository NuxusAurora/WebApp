from copy import deepcopy

from tests.test_knowledge import PAYLOAD
from tests.test_knowledge import apply as apply_knowledge
from tests.test_knowledge import draft as knowledge_draft
from tests.test_learning_projects import PROJECTS, seed_sections
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

TEXTBOOKS = f"{PROJECTS}/textbooks"
COURSES = "/api/v1/courses"


def textbook_items(client):
    response = client.get(TEXTBOOKS)
    assert response.status_code == 200, response.text
    return response.json()["data"]["items"]


def test_visibility_is_independent_of_archive_and_saved_conversations(account_app):
    app, client = account_app
    assert client.get(TEXTBOOKS).status_code == 401
    owner_cookie = authenticate(client, app)
    course, (section,) = seed_sections(client, 1)
    course_path = f"{COURSES}/{course}"
    folder_path = f"{TEXTBOOKS}/{course}"
    second_course = client.post(COURSES, json={"title": "微积分", "textbook": "高等数学"})
    second = second_course.json()["data"]["id"]
    assert client.put(folder_path).status_code == 200
    assert client.put(f"{TEXTBOOKS}/{second}").status_code == 200
    assert client.put(folder_path).status_code == 200
    assert textbook_items(client) == [
        {"id": course, "title": "线性代数"},
        {"id": second, "title": "高等数学"},
    ]

    knowledge = f"/api/v1/sections/{section}/knowledge-points"
    draft = knowledge_draft(client, knowledge, deepcopy(PAYLOAD))
    assert apply_knowledge(client, knowledge, draft).status_code == 200
    project = client.post(PROJECTS, json={"section_id": section}).json()["data"]
    open_path = f"{PROJECTS}/{project['id']}/open"

    authenticate(client, app, "other@example.com")
    assert textbook_items(client) == []
    assert client.get(COURSES).json()["data"] == []
    assert client.put(folder_path).status_code == 404
    assert client.delete(folder_path).status_code == 404
    client.cookies.set("learning_session", owner_cookie)

    assert client.delete(folder_path).status_code == 200
    assert client.delete(folder_path).status_code == 200
    assert [item["id"] for item in textbook_items(client)] == [second]
    assert {row["id"]: row["added_to_learning"] for row in client.get(COURSES).json()["data"]} == {
        course: False,
        second: True,
    }
    assert client.get(course_path).json()["data"]["status"] == "active"
    assert client.post(open_path, json={}).json()["data"]["conversation"] == project["conversation"]
    assert [item["id"] for item in textbook_items(client)] == [second]

    assert client.patch(course_path, json={"status": "archived"}).status_code == 200
    assert client.put(folder_path).status_code == 404
    assert client.delete(folder_path).status_code == 200
    assert client.get(course_path).json()["data"]["status"] == "archived"
    assert client.patch(course_path, json={"status": "active"}).status_code == 200
    assert [item["id"] for item in textbook_items(client)] == [second]
    assert client.put(folder_path).status_code == 200
    assert client.post(open_path, json={}).json()["data"]["conversation"] == project["conversation"]
    assert [item["id"] for item in textbook_items(client)] == [course, second]
    assert client.patch(course_path, json={"status": "archived"}).status_code == 200
    assert [item["id"] for item in textbook_items(client)] == [second]
    assert client.patch(course_path, json={"status": "active"}).status_code == 200
    assert [item["id"] for item in textbook_items(client)] == [course, second]
    assert client.delete(course_path).status_code == 200
    assert [item["id"] for item in textbook_items(client)] == [second]


def test_textbook_folders_paginate_without_requiring_sections(account_app):
    app, client = account_app
    authenticate(client, app)
    ids = []
    for number in range(8):
        course = client.post(COURSES, json={"title": f"课程 {number}"}).json()["data"]["id"]
        assert client.put(f"{TEXTBOOKS}/{course}").status_code == 200
        ids.append(course)
    first = client.get(TEXTBOOKS).json()["data"]
    assert [item["id"] for item in first["items"]] == ids[::-1][:6]
    assert {
        row["id"] for row in client.get(COURSES).json()["data"] if row["added_to_learning"]
    } == set(ids)
    second = client.get(TEXTBOOKS, params={"before": first["next_cursor"]}).json()["data"]
    assert [item["id"] for item in second["items"]] == ids[1::-1]
    assert second["next_cursor"] is None
    assert client.get(TEXTBOOKS, params={"before": "bad"}).status_code == 422
