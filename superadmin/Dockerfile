FROM node:20-alpine AS build

WORKDIR /app

RUN npm install -g pnpm

# Dependencias do Superadmin
COPY superadmin/package.json superadmin/pnpm-lock.yaml ./superadmin/
WORKDIR /app/superadmin
RUN pnpm install --no-frozen-lockfile

# Codigo necessario para build (superadmin + componentes compartilhados)
WORKDIR /app
COPY superadmin ./superadmin
COPY painel-provedor ./painel-provedor
COPY backend ./backend

WORKDIR /app/superadmin
RUN pnpm build

FROM nginx:1.27-alpine AS runtime

# SPA fallback para rotas do React Router
COPY superadmin/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/superadmin/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
