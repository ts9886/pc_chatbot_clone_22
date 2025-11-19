import os
import pandas as pd
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.naive_bayes import MultinomialNB
from model.preprocess import clean_text

DATASET_PATH = os.path.join(os.path.dirname(__file__), "..", "dataset", "computer_problems_solutions.csv")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "model", "chatbot_model.pkl")

# Load dataset
df = pd.read_csv(DATASET_PATH)
df.columns = df.columns.str.strip().str.lower()

df["clean_problem"] = df["problem"].apply(clean_text)

# Train model if not exists
if not os.path.exists(MODEL_PATH):
    vectorizer = TfidfVectorizer()
    X = vectorizer.fit_transform(df["clean_problem"])
    y = df["solution"]

    model = MultinomialNB()
    model.fit(X, y)

    with open(MODEL_PATH, "wb") as f:
        pickle.dump((model, vectorizer), f)

# Load model + vectorizer
with open(MODEL_PATH, "rb") as f:
    model, vectorizer = pickle.load(f)

# Store TFIDF matrix for all dataset problems
dataset_vectors = vectorizer.transform(df["clean_problem"])

def get_response(user_query: str) -> str:
    if not user_query.strip():
        return "⚠ Please enter a valid query."

    cleaned = clean_text(user_query)

    # STEP 1: Convert user query to vector
    user_vec = vectorizer.transform([cleaned])

    # STEP 2: Calculate cosine similarity to all dataset questions
    similarities = cosine_similarity(user_vec, dataset_vectors)[0]

    # STEP 3: Find best match
    best_index = similarities.argmax()
    best_score = similarities[best_index]

    # STEP 4: Check similarity threshold
    if best_score < 0.40:
        return "❗ I do not understand this query. Please ask only computer-related questions."

    # STEP 5: Return matched solution
    return df["solution"].iloc[best_index]
