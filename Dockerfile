# littlechef
# 一层镜像，跑在 NAS 上就够了。x86 的群晖/威联通和 ARM 的都能用。
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    LITTLE_CHEF_DATA_DIR=/data \
    LITTLE_CHEF_PORT=8848 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY web ./web
COPY seed ./seed
COPY scripts ./scripts

# 数据全在这里：菜谱、食材、菜单、插画。挂出去就是备份。
VOLUME ["/data"]
EXPOSE 8848

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('LITTLE_CHEF_PORT','8848')+'/api/health').read()"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${LITTLE_CHEF_PORT:-8848}"]
