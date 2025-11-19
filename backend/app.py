import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from flask import Flask, request, jsonify, render_template, redirect, url_for, session, flash
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
from functools import wraps
from backend.chatbot import get_response

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE_DIR, "users.db")

app = Flask(__name__, template_folder="../frontend/templates", static_folder="../frontend/static")
CORS(app)
app.secret_key = os.environ.get("FLASK_SECRET", "replace_this_with_random_secret")  # set env var in production

# -------------------------
# Simple SQLite helpers
# -------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def create_user(username, password_plain):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    hashed = generate_password_hash(password_plain)
    try:
        c.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def verify_user(username, password_plain):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT password FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()
    if not row:
        return False
    return check_password_hash(row[0], password_plain)

# Initialize DB at app start
init_db()

# -------------------------
# Auth decorator
# -------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

# -------------------------
# Routes
# -------------------------
@app.route("/")
def home():
    return render_template("home.html")

@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        data = request.form
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        if not username or not password:
            flash("Please provide username and password", "error")
            return redirect(url_for("signup"))
        ok = create_user(username, password)
        if not ok:
            flash("Username already taken", "error")
            return redirect(url_for("signup"))
        flash("Account created — please login", "success")
        return redirect(url_for("login"))
    return render_template("signup.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        data = request.form
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        if verify_user(username, password):
            session["user"] = username
            flash("Logged in successfully", "success")
            return redirect(url_for("chatbot_page"))
        else:
            flash("Invalid credentials", "error")
            return redirect(url_for("login"))
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.pop("user", None)
    flash("Logged out", "info")
    return redirect(url_for("home"))

@app.route("/chatbot")
@login_required
def chatbot_page():
    return render_template("chatbot.html")

# Chat API — keep it protected so only logged-in users can call
@app.route("/chat", methods=["POST"])
@login_required
def chat():
    data = request.get_json()
    user_query = data.get("message", "")
    if not user_query.strip():
        return jsonify({"response": "Please type a valid question."})
    bot_reply = get_response(user_query)
    return jsonify({"response": bot_reply})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
