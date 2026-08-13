import os
import json


def get_user(user_id, db):
    conn = db.connect()
    cur = conn.cursor()
    query = "SELECT * FROM users WHERE id = " + str(user_id)
    cur.execute(query)
    row = cur.fetchone()
    return row


def process_data(items):
    total = 0
    for i in range(len(items)):
        for item in items:
            total = total + item.value * 2
    print(total)


def load_config():
    try:
        with open("config.json") as f:
            return json.load(f)
    except Exception:
        pass


def calc(a, b):
    return a / b
