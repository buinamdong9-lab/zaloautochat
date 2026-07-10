FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py .
COPY sender.py .
COPY scheduler.py .
COPY web.py .
COPY main.py .
COPY templates/ templates/

RUN mkdir -p /app/logs

EXPOSE 5100

CMD ["python", "main.py", "web"]
