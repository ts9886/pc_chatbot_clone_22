import pandas as pd
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from preprocess import clean_text

df = pd.read_csv("dataset/computer_problems_solutions.csv")
df.columns = df.columns.str.strip().str.lower()

df["clean_problem"] = df["problem"].apply(clean_text)

X = df["clean_problem"]
y = df["solution"]

vectorizer = TfidfVectorizer()
X_vec = vectorizer.fit_transform(X)

model = MultinomialNB()
model.fit(X_vec, y)

with open("model/chatbot_model.pkl", "wb") as f:
    pickle.dump((model, vectorizer), f)

print("Model trained and saved!")
