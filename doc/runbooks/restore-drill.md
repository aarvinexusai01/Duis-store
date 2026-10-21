# Restore drill

A backup counts only once it has been restored. `ops/restore-drill.sh` runs
early each month (a systemd timer, 04:00 IST on a Sunday) and can be run by
hand at any time:

```sh
ops/restore-drill.sh          # restore, check, record, clean up
ops/restore-drill.sh --keep   # leave the restored copy running to inspect it
```

It restores the newest backup into a separate project (`duis-drill`) on the
same server. That project has its own volumes and no network ports, and
never writes to the bucket. It checks that:

- the database finishes recovery;
- every order, order item, payment, customer, product and image record that existed at the restored moment is present;
- 20 random images match production byte for byte.

It also measures:
- the data loss window (RPO): how far behind production the restored copy is;
- the restore time (RTO): from start until data and images are back.

The result is recorded as the **Monthly restore drill** server check, e.g.
"Restored in 4m (database 2m); data loss window 3m; 6 tables checked;
20/20 images match."

## When it fails

- **The alert says where it stopped:** run it by hand to see the output.
- **Restore errors mentioning the bucket or the passphrase:** check the R2 token and `PGBACKREST_CIPHER_PASS` / `RESTIC_PASSWORD`. If the passphrases in `.env.infra` no longer match the ones the backups were made with, nothing can be restored. Treat that as an incident.
- **Counts differ or images don't match:** keep the drill copy (`--keep`) and compare. Inspect it with `docker compose -p duis-drill exec postgres psql -U postgres duis`. Then take a fresh full backup and run the drill again.
- **Clean up a kept drill:** `docker compose -p duis-drill down -v`.

Twice a year, also restore onto a **separate** server ([Restore: the server
is gone](restore.md#the-server-is-gone)). That also proves the setup steps and
the password-manager copies of the secrets.
