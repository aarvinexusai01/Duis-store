# syntax=docker/dockerfile:1.12
#
# PostgreSQL 18 with pgBackRest, plus the backup tools (restic, supercronic).
# One image serves the `postgres` service and the `backup` service, so the
# pgBackRest, pg_dump and server versions always match (doc/07 §2, §6).
ARG POSTGRES_IMAGE=postgres:18.6-trixie
FROM ${POSTGRES_IMAGE}

ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256_amd64=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1
ARG SUPERCRONIC_SHA256_arm64=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest restic ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "${TARGETARCH}" in amd64) sum="${SUPERCRONIC_SHA256_amd64}" ;; arm64) sum="${SUPERCRONIC_SHA256_arm64}" ;; *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; esac; \
    curl -fsSLo /usr/local/bin/supercronic "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}"; \
    echo "${sum}  /usr/local/bin/supercronic" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/supercronic

COPY initdb/ /docker-entrypoint-initdb.d/
COPY conf/postgresql.conf conf/pg_hba.conf /etc/postgresql/
COPY conf/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY conf/crontab /etc/duis/crontab
COPY bin/ /usr/local/bin/

RUN mkdir -p /var/spool/pgbackrest /var/cache/restic \
 && chown postgres:postgres /var/spool/pgbackrest /var/cache/restic \
 && chmod 0755 /usr/local/bin/duis-backup
