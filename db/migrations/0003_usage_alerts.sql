-- Usage alerts and service-side cost counters (spec section 12).

-- One row per threshold fired for a license in a period, so each alert fires once.
CREATE TABLE usage_alerts (
  license_id    text NOT NULL REFERENCES licenses (license_id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  threshold     smallint NOT NULL CHECK (threshold IN (80, 100)),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (license_id, period_start, threshold)
);

-- /img carries no key, so transforms and bytes are costs of the service, tracked per DID.
CREATE TABLE service_usage_counters (
  did           text NOT NULL,
  meter         text NOT NULL CHECK (meter IN ('transform', 'bytes_delivered')),
  period_start  date NOT NULL,
  count         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (did, meter, period_start)
);
