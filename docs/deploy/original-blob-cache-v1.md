# Original blob cache

Delivery keeps recently fetched original images in memory so a burst of resize requests for one image hits the PDS once.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BLOB_CACHE_MB` | `32` | Size cap in megabytes for the in-memory original cache, per process. `0` turns it off. Invalid values fall back to the default. |

Size the cap against the machine memory, since each delivery process holds its own copy. The failing-host skip (30 seconds, up to 256 hosts) and the retry count (2) are fixed in code. Look for `getBlob` log lines with `outcome` values `ok`, `cache_hit`, `not_found`, `server_error`, `timeout`, `network_error`, `negative_cache`, and `invalid_endpoint`.
