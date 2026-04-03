declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
    STORE_PATH?: string;
    AUDIT_DB_PATH?: string;
    AUDIT_FALLBACK_PATH?: string;
    DATA_ENCRYPTION_KEY?: string;
    RATE_LIMIT_PER_MIN?: string;
    DOWNLOAD_RATE_LIMIT_PER_MIN?: string;
    ALLOWED_CONTACTS?: string;
    DISABLED_TOOLS?: string;
    MESSAGE_RETENTION_DAYS?: string;
    SEND_READ_RECEIPTS?: string;
    AUTO_READ_RECEIPTS?: string;
    PRESENCE_MODE?: string;
    WELCOME_GROUP_NAME?: string;
    AUTO_CONNECT_ON_STARTUP?: string;
    AUTH_WAIT_FOR_LINK?: string;
    AUTH_LINK_TIMEOUT_SEC?: string;
    AUTH_POLL_INTERVAL_SEC?: string;
    DEBUG?: string;
    TZ?: string;
  }
}
