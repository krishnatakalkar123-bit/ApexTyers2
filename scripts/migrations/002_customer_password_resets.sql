-- ONE-TIME MIGRATION: apply only after 001_customer_accounts.sql has succeeded.
-- Do not run automatically during application startup.

BEGIN;

CREATE TABLE public.customer_password_resets (
  customer_id INTEGER PRIMARY KEY
    REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  otp_hash BYTEA NOT NULL
    CHECK (octet_length(otp_hash) = 32),
  otp_expires_at TIMESTAMPTZ NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 5),
  resend_available_at TIMESTAMPTZ NOT NULL,
  resend_count SMALLINT NOT NULL DEFAULT 1
    CHECK (resend_count BETWEEN 1 AND 3),
  resend_window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  otp_consumed_at TIMESTAMPTZ,
  reset_token_hash BYTEA UNIQUE
    CHECK (reset_token_hash IS NULL OR octet_length(reset_token_hash) = 32),
  reset_token_expires_at TIMESTAMPTZ,
  reset_consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_password_resets_expiry_check
    CHECK (otp_expires_at > created_at),
  CONSTRAINT customer_password_resets_cooldown_check
    CHECK (resend_available_at >= created_at),
  CONSTRAINT customer_password_resets_token_pair_check
    CHECK (
      (reset_token_hash IS NULL AND reset_token_expires_at IS NULL) OR
      (reset_token_hash IS NOT NULL AND reset_token_expires_at IS NOT NULL)
    ),
  CONSTRAINT customer_password_resets_consumed_check
    CHECK (
      (otp_consumed_at IS NULL OR otp_consumed_at >= created_at) AND
      (reset_consumed_at IS NULL OR reset_consumed_at >= created_at)
    )
);

CREATE INDEX customer_password_resets_otp_expiry_idx
  ON public.customer_password_resets (otp_expires_at);

CREATE INDEX customer_password_resets_token_expiry_idx
  ON public.customer_password_resets (reset_token_expires_at)
  WHERE reset_token_hash IS NOT NULL;

COMMIT;
