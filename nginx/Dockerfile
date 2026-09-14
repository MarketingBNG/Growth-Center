# A separate image from the app's own Dockerfile — different job, different
# lifecycle, different rebuild cadence. See the "why separate" discussion in
# README/chat history: one container, one responsibility.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
