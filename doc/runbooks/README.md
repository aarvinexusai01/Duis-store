# Runbooks

Step-by-step procedures for running Duis in production (doc/07). Every
command runs on the server as the `deploy` user from `/srv/duis`, unless the
step says otherwise.

| Runbook | Use it when |
|---|---|
| [First server setup](first-server-setup.md) | Bringing up a new server |
| [Deploy](deploy.md) | Releasing a new version, or restarting Postgres or Nginx for an image update |
| [Rollback](rollback.md) | A release misbehaves |
| [Restore](restore.md) | Data was lost or damaged, a migration went wrong, or the server is gone |
| [Restore drill](restore-drill.md) | The monthly drill failed, or you want to run it by hand |
| [Incident first steps](incident.md) | An alert email arrived, or the uptime monitor says the site is down |
| [Secret rotation](secret-rotation.md) | A key leaked, staff left, or a certificate is expiring |
| [Adding a replica](add-replica.md) | Two web replicas are no longer enough |
| [Moving media to R2](media-to-r2.md) | The media volume outgrows the server's disk |
| [Local production stack](local-stack.md) | Trying deploys, rollbacks or restores on a laptop |
| [Cache and search](cache-and-search.md) | Redis or Elasticsearch is failing, search shows old results, or a page shows old content |

## Which alert, which runbook

Alert emails (from `OPS_ALERT_EMAIL`) and the **Server checks** panel on
`/admin/system` use these names:

| Check | Runbook |
|---|---|
| Background worker, Failed background jobs, Job queues | [Incident: worker and jobs](incident.md#worker-and-jobs) |
| Continuous database archiving (WAL), Database backup, Nightly copy | [Incident: backups](incident.md#backups) |
| Monthly restore drill | [Restore drill](restore-drill.md) |
| Server disk space, Server memory, Containers | [Incident: the server](incident.md#the-server) |
| Origin certificate | [Secret rotation: origin certificate](secret-rotation.md#origin-certificate) |
| Shared cache (Redis), Product search (Elasticsearch) | [Cache and search](cache-and-search.md) |
| UptimeRobot: site down | [Incident: site down](incident.md#site-down) |
