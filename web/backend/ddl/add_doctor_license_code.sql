-- 已有库追加「医师执照号」列（在 health_platform 下执行一次）
-- 新库若由 SQLAlchemy create_all 空表创建，一般已含该列，无需执行本脚本。

ALTER TABLE doctor_accounts
  ADD COLUMN license_code VARCHAR(64) NULL COMMENT '医师执照号' AFTER password_hash;

CREATE UNIQUE INDEX ux_doctor_accounts_license_code ON doctor_accounts (license_code);

-- 若你曾把执照误存在 certification_status，可迁到新列后再清空旧字段（按需、先备份）：
-- UPDATE doctor_accounts
-- SET license_code = certification_status
-- WHERE license_code IS NULL AND certification_status IS NOT NULL AND certification_status REGEXP '^[0-9A-Za-z]';
