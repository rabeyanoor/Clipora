FROM python:3.11-slim
RUN useradd -m -u 1000 user
WORKDIR /app
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user app.py .
USER user
ENV HF_HOME=/home/user/.cache/huggingface
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
