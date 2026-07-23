# SGI-HECC — build estático (Vite/React) servido por nginx.
#
# ATENÇÃO ÀS VARIÁVEIS: o Vite injeta VITE_* no bundle em tempo de BUILD, não
# em tempo de execução. Por isso elas entram como ARG (build args) e não como
# env do container. Se forem definidas só como env de runtime, o app sobe com
# a URL do Supabase "undefined" e não conecta.
#
# No EasyPanel: aba Build -> Build Args (ou "Environment" marcado para build).

# ---------- Estágio 1: build ----------
FROM node:20-alpine AS build

WORKDIR /app

# Instala dependências primeiro (camada cacheada enquanto o lock não mudar).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Variáveis obrigatórias do build.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Falha cedo e com mensagem clara em vez de gerar um bundle quebrado.
RUN test -n "$VITE_SUPABASE_URL" || (echo "ERRO: build arg VITE_SUPABASE_URL nao informado" && exit 1)
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "ERRO: build arg VITE_SUPABASE_ANON_KEY nao informado" && exit 1)

# "npm run build" roda tsc && vite build — o build falha se houver erro de tipo.
RUN npm run build

# ---------- Estágio 2: runtime ----------
FROM nginx:1.27-alpine

# O template é processado por envsubst na subida do container (recurso nativo
# da imagem oficial do nginx: /etc/nginx/templates/*.template).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Deriva a origem wss:// (Realtime) antes do envsubst rodar.
COPY docker/15-derive-ws.envsh /docker-entrypoint.d/15-derive-ws.envsh
RUN chmod +x /docker-entrypoint.d/15-derive-ws.envsh

# Origem do Supabase usada na CSP (connect-src/img-src). Por padrão é a mesma
# do build; pode ser sobrescrita como env do container no EasyPanel.
ARG VITE_SUPABASE_URL
ENV SUPABASE_ORIGIN=$VITE_SUPABASE_URL

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
