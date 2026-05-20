import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'memory.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def save_message(role, content):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO messages (role, content) VALUES (?, ?)", (role, content))
    conn.commit()
    conn.close()

def load_context_for_llm(max_len):
    """
    优先加载最新的总结，然后加载总结之后的对话。
    如果没有总结，则加载最近的 max_len 条。
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # 查找最近的一次总结
    c.execute("SELECT id, content FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1")
    summary_row = c.fetchone()
    
    messages = []
    if summary_row:
        summary_id, summary_content = summary_row
        messages.append({"role": "system", "content": f"[前情提要/记忆总结]: {summary_content}"})
        # 获取总结之后的所有对话（限制上限）
        c.execute("SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?", (summary_id, max_len))
        recent_rows = c.fetchall()
    else:
        # 如果没有总结，查最近的
        c.execute("SELECT role, content FROM messages ORDER BY id DESC LIMIT ?", (max_len,))
        recent_rows = reversed(c.fetchall())
        
    for r in recent_rows:
        messages.append({"role": r[0], "content": r[1]})
        
    conn.close()
    return messages

def get_unsummarized_count():
    """获取距离上次总结后，新增的未总结对话数量"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    if row:
        c.execute("SELECT count(*) FROM messages WHERE id > ?", (row[0],))
        count = c.fetchone()[0]
    else:
        c.execute("SELECT count(*) FROM messages")
        count = c.fetchone()[0]
    conn.close()
    return count

def get_unsummarized_messages():
    """获取所有未总结的对话详情"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1")
    row = c.fetchone()
    if row:
        c.execute("SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC", (row[0],))
    else:
        c.execute("SELECT role, content FROM messages ORDER BY id ASC")
    rows = c.fetchall()
    conn.close()
    return [{"role": r[0], "content": r[1]} for r in rows]
