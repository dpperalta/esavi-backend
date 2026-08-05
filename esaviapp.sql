
/*
  ESAVI Web Application - OpPostgreSQL schema v9.1.9
  Target: PostgreSQL 12+
  Design notes:
  - Uses camelCase identifiers quoted for PostgreSQL compatibility.
  - Avoids reserved table names such as "case" and "event".
  - Uses UUID primary keys with gen_random_uuid().
  - Uses a generic catalog model for homogeneous option sets.
  - Keeps domain entities separated: geography, health facilities, WHODrug vaccines, diagnostic terms.
  - Uses answerOption enum for fields whose valid values are not strictly boolean.
  - Uses investigationId / notificationId as PK+FK in 1:1 section tables.
  - Uses ON DELETE CASCADE only for transactional child rows; RESTRICT for catalogs and master data.
  - Auto-assigns sortOrder in selected child tables using parent-aware triggers.
  - Adds sysDetails JSONB to every table and maintains creation/update/soft-delete audit metadata through triggers.
  - Adds appDetails JSONB to every table for backend-managed application traceability.
  - Adds administrative tables for users, roles, permissions, sessions and system configuration.
*/

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  CREATE TYPE "answerOption" AS ENUM ('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "notificationType" AS ENUM ('SEVERE', 'NON_SEVERE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "termSource" AS ENUM ('MEDDRA', 'WHODRUG', 'LOCAL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION "setSysDetails"()
RETURNS trigger AS $$
DECLARE
  v_actor text;
  v_now timestamptz := current_timestamp;
  v_previous jsonb;
  v_event jsonb;
  v_operation text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."createdAt" := COALESCE(NEW."createdAt", v_now);
    NEW."updatedAt" := COALESCE(NEW."updatedAt", NEW."createdAt");
    v_previous := COALESCE(NEW."sysDetails", '{}'::jsonb);
    v_actor := COALESCE(v_previous #>> '{request,username}', v_previous #>> '{request,userId}', current_user);
    v_operation := 'INSERT';

    v_event := jsonb_build_object(
      'operation', v_operation,
      'occurredAt', v_now,
      'actor', v_actor,
      'request', COALESCE(v_previous -> 'request', '{}'::jsonb)
    );

    NEW."sysDetails" :=
      v_previous
      || jsonb_build_object(
           'createdAt', COALESCE(v_previous ->> 'createdAt', to_jsonb(NEW."createdAt") #>> '{}'),
           'createdBy', COALESCE(v_previous ->> 'createdBy', v_actor),
           'updatedAt', to_jsonb(NEW."updatedAt") #>> '{}',
           'updatedBy', v_actor,
           'version', COALESCE((v_previous ->> 'version')::integer, 0) + 1,
           'auditTrail', COALESCE(v_previous -> 'auditTrail', '[]'::jsonb) || jsonb_build_array(v_event)
         );

    NEW."sysDetails" := NEW."sysDetails" - 'request';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW."updatedAt" := v_now;
    v_previous := COALESCE(OLD."sysDetails", '{}'::jsonb) || COALESCE(NEW."sysDetails", '{}'::jsonb);
    v_actor := COALESCE(COALESCE(NEW."sysDetails", '{}'::jsonb) #>> '{request,username}', COALESCE(NEW."sysDetails", '{}'::jsonb) #>> '{request,userId}', current_user);

    IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
      v_operation := 'SOFT_DELETE';
    ELSE
      v_operation := 'UPDATE';
    END IF;

    v_event := jsonb_build_object(
      'operation', v_operation,
      'occurredAt', v_now,
      'actor', v_actor,
      'request', COALESCE(COALESCE(NEW."sysDetails", '{}'::jsonb) -> 'request', '{}'::jsonb)
    );

    NEW."sysDetails" :=
      v_previous
      || jsonb_build_object(
           'createdAt', COALESCE(v_previous ->> 'createdAt', to_jsonb(OLD."createdAt") #>> '{}'),
           'createdBy', COALESCE(v_previous ->> 'createdBy', current_user),
           'updatedAt', to_jsonb(NEW."updatedAt") #>> '{}',
           'updatedBy', v_actor,
           'deletedAt', CASE WHEN v_operation = 'SOFT_DELETE' THEN to_jsonb(NEW."deletedAt") #>> '{}' ELSE v_previous ->> 'deletedAt' END,
           'deletedBy', CASE WHEN v_operation = 'SOFT_DELETE' THEN v_actor ELSE v_previous ->> 'deletedBy' END,
           'version', COALESCE((v_previous ->> 'version')::integer, 0) + 1,
           'auditTrail', COALESCE(v_previous -> 'auditTrail', '[]'::jsonb) || jsonb_build_array(v_event)
         );

    NEW."sysDetails" := NEW."sysDetails" - 'request';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "setUpdatedAt"()
RETURNS trigger AS $$
BEGIN
  RETURN "setSysDetails"();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "preventPhysicalDelete"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Physical delete is not allowed for table %. Use deletedAt for soft delete.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validateCatalogItemType"("pCatalogItemId" uuid, "pCatalogTypeCode" text)
RETURNS boolean AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF "pCatalogItemId" IS NULL THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "catalogItem" ci
    JOIN "catalogType" ct ON ct."catalogTypeId" = ci."catalogTypeId"
    WHERE ci."catalogItemId" = "pCatalogItemId"
      AND ct."code" = "pCatalogTypeCode"
      AND ci."deletedAt" IS NULL
      AND ct."deletedAt" IS NULL
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Catalog item % does not belong to catalog type %', "pCatalogItemId", "pCatalogTypeCode";
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "setSortOrderByParent"()
RETURNS trigger AS $$
DECLARE
  parent_column text := TG_ARGV[0];
  parent_value text;
  next_order smallint;
BEGIN
  IF parent_column IS NULL OR parent_column = '' THEN
    RAISE EXCEPTION 'setSortOrderByParent requires the parent column name as first argument';
  END IF;

  IF NEW."sortOrder" IS NOT NULL AND NEW."sortOrder" > 0 THEN
    RETURN NEW;
  END IF;

  parent_value := to_jsonb(NEW) ->> parent_column;

  IF parent_value IS NULL OR parent_value = '' THEN
    RAISE EXCEPTION 'Cannot assign sortOrder in table %. Parent column % is null', TG_TABLE_NAME, parent_column;
  END IF;

  -- Prevent duplicate order values when two rows are inserted concurrently for the same parent.
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || parent_column || ':' || parent_value));

  EXECUTE format(
    'SELECT COALESCE(MAX("sortOrder"), 0) + 1 FROM %I WHERE %I::text = $1 AND "deletedAt" IS NULL',
    TG_TABLE_NAME,
    parent_column
  )
  INTO next_order
  USING parent_value;

  NEW."sortOrder" := next_order;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Generic catalogs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "catalogType" (
  "catalogTypeId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_catalogType_code" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "catalogItem" (
  "catalogItemId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "catalogTypeId" uuid NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(250) NOT NULL,
  "value" varchar(250),
  "description" text,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_catalogItem_catalogType" FOREIGN KEY ("catalogTypeId") REFERENCES "catalogType" ("catalogTypeId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_catalogItem_type_code" UNIQUE ("catalogTypeId", "code")
);
CREATE INDEX IF NOT EXISTS "IX_catalogItem_catalogTypeId" ON "catalogItem" ("catalogTypeId");
CREATE INDEX IF NOT EXISTS "IX_catalogItem_active" ON "catalogItem" ("isActive") WHERE "deletedAt" IS NULL;

-- -----------------------------------------------------------------------------
-- Application administration
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "appUser" (
  "userId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "username" citext NOT NULL,
  "email" citext,
  "passwordHash" text,
  "externalProvider" varchar(100),
  "externalSubject" varchar(200),
  "displayName" varchar(250) NOT NULL,
  "firstName" varchar(150),
  "lastName" varchar(150),
  "phone" varchar(50),
  "statusItemId" uuid,
  "lastLoginAt" timestamptz,
  "requiresPasswordChange" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_appUser_username" UNIQUE ("username"),
  CONSTRAINT "UQ_appUser_email" UNIQUE ("email"),
  CONSTRAINT "FK_appUser_statusItem" FOREIGN KEY ("statusItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "CK_appUser_authSource" CHECK ("passwordHash" IS NOT NULL OR "externalSubject" IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "IX_appUser_statusItemId" ON "appUser" ("statusItemId");
CREATE INDEX IF NOT EXISTS "IX_appUser_active" ON "appUser" ("isActive") WHERE "deletedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "appRole" (
  "roleId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "level" integer NOT NULL DEFAULT 1 CHECK ("level" >= 0),
  "isSystemRole" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_appRole_code" UNIQUE ("code")
);
CREATE INDEX IF NOT EXISTS "IX_appRole_active" ON "appRole" ("isActive") WHERE "deletedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "appPermission" (
  "permissionId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(150) NOT NULL,
  "module" varchar(100) NOT NULL,
  "action" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_appPermission_code" UNIQUE ("code"),
  CONSTRAINT "UQ_appPermission_module_action" UNIQUE ("module", "action")
);
CREATE INDEX IF NOT EXISTS "IX_appPermission_module" ON "appPermission" ("module");

CREATE TABLE IF NOT EXISTS "appUserRole" (
  "userRoleId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "roleId" uuid NOT NULL,
  "validFrom" timestamptz NOT NULL DEFAULT current_timestamp,
  "validTo" timestamptz,
  "assignedByUserId" uuid,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_appUserRole_user" FOREIGN KEY ("userId") REFERENCES "appUser" ("userId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_appUserRole_role" FOREIGN KEY ("roleId") REFERENCES "appRole" ("roleId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_appUserRole_assignedByUser" FOREIGN KEY ("assignedByUserId") REFERENCES "appUser" ("userId") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "CK_appUserRole_dates" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_appUserRole_active_user_role"
  ON "appUserRole" ("userId", "roleId")
  WHERE "deletedAt" IS NULL AND "isActive" = true AND "validTo" IS NULL;
CREATE INDEX IF NOT EXISTS "IX_appUserRole_userId" ON "appUserRole" ("userId");
CREATE INDEX IF NOT EXISTS "IX_appUserRole_roleId" ON "appUserRole" ("roleId");

CREATE TABLE IF NOT EXISTS "appRolePermission" (
  "rolePermissionId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roleId" uuid NOT NULL,
  "permissionId" uuid NOT NULL,
  "isAllowed" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_appRolePermission_role" FOREIGN KEY ("roleId") REFERENCES "appRole" ("roleId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_appRolePermission_permission" FOREIGN KEY ("permissionId") REFERENCES "appPermission" ("permissionId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_appRolePermission_role_permission" UNIQUE ("roleId", "permissionId")
);
CREATE INDEX IF NOT EXISTS "IX_appRolePermission_roleId" ON "appRolePermission" ("roleId");
CREATE INDEX IF NOT EXISTS "IX_appRolePermission_permissionId" ON "appRolePermission" ("permissionId");

CREATE TABLE IF NOT EXISTS "appSession" (
  "sessionId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "refreshTokenHash" text,
  "ipAddress" inet,
  "userAgent" text,
  "startedAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "expiresAt" timestamptz,
  "revokedAt" timestamptz,
  "revokedReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_appSession_user" FOREIGN KEY ("userId") REFERENCES "appUser" ("userId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "CK_appSession_dates" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startedAt")
);
CREATE INDEX IF NOT EXISTS "IX_appSession_userId" ON "appSession" ("userId");
CREATE INDEX IF NOT EXISTS "IX_appSession_active" ON "appSession" ("userId", "expiresAt") WHERE "revokedAt" IS NULL AND "deletedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "systemConfig" (
  "systemConfigId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(150) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "valueType" varchar(50) NOT NULL DEFAULT 'json',
  "scope" varchar(100) NOT NULL DEFAULT 'GLOBAL',
  "isEncrypted" boolean NOT NULL DEFAULT false,
  "isEditable" boolean NOT NULL DEFAULT true,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_systemConfig_code_scope" UNIQUE ("code", "scope"),
  CONSTRAINT "CK_systemConfig_valueType" CHECK ("valueType" IN ('string', 'number', 'boolean', 'json', 'array'))
);
CREATE INDEX IF NOT EXISTS "IX_systemConfig_active" ON "systemConfig" ("isActive") WHERE "deletedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "systemConfigHistory" (
  "systemConfigHistoryId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "systemConfigId" uuid NOT NULL,
  "previousValue" jsonb,
  "newValue" jsonb NOT NULL,
  "changedByUserId" uuid,
  "changeReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_systemConfigHistory_config" FOREIGN KEY ("systemConfigId") REFERENCES "systemConfig" ("systemConfigId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_systemConfigHistory_changedByUser" FOREIGN KEY ("changedByUserId") REFERENCES "appUser" ("userId") ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "IX_systemConfigHistory_config" ON "systemConfigHistory" ("systemConfigId", "createdAt" DESC);

-- -----------------------------------------------------------------------------
-- Geography and health facilities
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "geoLevelType" (
  "geoLevelTypeId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) NOT NULL UNIQUE,
  "name" varchar(150) NOT NULL,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS "geoLocation" (
  "geoLocationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "geoLevelTypeId" uuid NOT NULL,
  "parentGeoLocationId" uuid,
  "name" varchar(200) NOT NULL,
  "officialName" varchar(250),
  "shortName" varchar(100),
  "isoCode" varchar(20),
  "externalCode" varchar(100),
  "latitude" numeric(10,7),
  "longitude" numeric(10,7),
  "geoPolygon" geometry(MultiPolygon, 4326),
  "level" smallint,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_geoLocation_geoLevelType" FOREIGN KEY ("geoLevelTypeId") REFERENCES "geoLevelType" ("geoLevelTypeId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_geoLocation_parent" FOREIGN KEY ("parentGeoLocationId") REFERENCES "geoLocation" ("geoLocationId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "CK_geoLocation_notSelfParent" CHECK ("parentGeoLocationId" IS NULL OR "parentGeoLocationId" <> "geoLocationId"),
  CONSTRAINT "UQ_geoLocation_parent_name" UNIQUE ("parentGeoLocationId", "name")
);
CREATE INDEX IF NOT EXISTS "IX_geoLocation_level" ON "geoLocation" ("geoLevelTypeId");
CREATE INDEX IF NOT EXISTS "IX_geoLocation_parent" ON "geoLocation" ("parentGeoLocationId");

CREATE TABLE IF NOT EXISTS "healthFacility" (
  "healthFacilityId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "geoLocationId" uuid,
  "parentHealthFacilityId" uuid,
  "facilityTypeItemId" uuid,
  "localCode" varchar(200),
  "name" varchar(250) NOT NULL,
  "officialName" varchar(250),
  "shortName" varchar(100),
  "address" varchar(250),
  "latitude" numeric(10,7),
  "longitude" numeric(10,7),
  "phone" varchar(50),
  "email" citext,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_healthFacility_geoLocation" FOREIGN KEY ("geoLocationId") REFERENCES "geoLocation" ("geoLocationId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_healthFacility_parent" FOREIGN KEY ("parentHealthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_healthFacility_type" FOREIGN KEY ("facilityTypeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "CK_healthFacility_notSelfParent" CHECK ("parentHealthFacilityId" IS NULL OR "parentHealthFacilityId" <> "healthFacilityId"),
  CONSTRAINT "UQ_healthFacility_localCode" UNIQUE ("localCode")
);
CREATE INDEX IF NOT EXISTS "IX_healthFacility_geoLocation" ON "healthFacility" ("geoLocationId");
CREATE INDEX IF NOT EXISTS "IX_healthFacility_parent" ON "healthFacility" ("parentHealthFacilityId");
CREATE INDEX IF NOT EXISTS "IX_healthFacility_type" ON "healthFacility" ("facilityTypeItemId");

CREATE OR REPLACE FUNCTION "trgValidateHealthFacilityCatalogs"()
RETURNS trigger AS $$
BEGIN
  PERFORM "validateCatalogItemType"(NEW."facilityTypeItemId", 'healthFacilityType');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public."appUserGeoLocation" (
    "userGeoLocationId" uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    "geoLocationId" uuid NOT NULL,
    "validFrom" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "validTo" timestamptz NULL,
    "assignedByUserId" uuid NULL,
    "isActive" bool DEFAULT true NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz NULL,
    "deletedAt" timestamptz NULL,
    "sysDetails" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "appDetails" jsonb DEFAULT '{}'::jsonb NOT NULL,

    CONSTRAINT "appUserGeoLocation_pkey" PRIMARY KEY ("userGeoLocationId"),
    CONSTRAINT "CK_appUserGeoLocation_dates" 
        CHECK (("validTo" IS NULL) OR ("validTo" > "validFrom"))
);

CREATE INDEX "IX_appUserGeoLocation_userId"
ON public."appUserGeoLocation" USING btree ("userId");

CREATE INDEX "IX_appUserGeoLocation_geoLocationId"
ON public."appUserGeoLocation" USING btree ("geoLocationId");

CREATE INDEX "IX_appUserGeoLocation_assignedByUserId"
ON public."appUserGeoLocation" USING btree ("assignedByUserId");

CREATE UNIQUE INDEX "UQ_appUserGeoLocation_active_user_geoLocation"
ON public."appUserGeoLocation"
USING btree ("userId", "geoLocationId")
WHERE (
    "deletedAt" IS NULL
    AND "isActive" = true
    AND "validTo" IS NULL
);

CREATE TRIGGER "TRG_appUserGeoLocation_setSysDetails"
BEFORE INSERT OR UPDATE
ON public."appUserGeoLocation"
FOR EACH ROW
EXECUTE FUNCTION "setSysDetails"();

ALTER TABLE public."appUserGeoLocation"
ADD CONSTRAINT "FK_appUserGeoLocation_user"
FOREIGN KEY ("userId")
REFERENCES public."appUser"("userId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."appUserGeoLocation"
ADD CONSTRAINT "FK_appUserGeoLocation_geoLocation"
FOREIGN KEY ("geoLocationId")
REFERENCES public."geoLocation"("geoLocationId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."appUserGeoLocation"
ADD CONSTRAINT "FK_appUserGeoLocation_assignedByUser"
FOREIGN KEY ("assignedByUserId")
REFERENCES public."appUser"("userId")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Domain master data
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "diagnosticTerm" (
  "diagnosticTermId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" "termSource" NOT NULL DEFAULT 'LOCAL',
  "code" varchar(100),
  "name" varchar(500) NOT NULL,
  "termGroup" varchar(250),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_diagnosticTerm_source_code" UNIQUE ("source", "code")
);

CREATE TABLE IF NOT EXISTS "vaccineWhodrug" (
  "vaccineWhodrugId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "externalId" integer,
  "drugCode" varchar(250),
  "drugRecNo" varchar(50),
  "drugRecNoSeq" varchar(50),
  "drugName" text NOT NULL,
  "language" varchar(10),
  "medicinalProductId" varchar(250),
  "acts" varchar(250),
  "icd11" varchar(250),
  "icd11Term" varchar(500),
  "ingredientTranslation" text,
  "languageCode" varchar(100),
  "iso3Code" varchar(250),
  "countryMedicinalProductId" varchar(250),
  "maHolders" text,
  "maHoldersMedicinalProductId" varchar(250),
  "form" text,
  "formTranslations" text,
  "formMedicinalProductId" varchar(250),
  "strength" text,
  "strengthMedicinalProductId" varchar(250),
  "noDose" text,
  "diluent" text,
  "isGeneric" boolean,
  "isPreferred" boolean NOT NULL DEFAULT false,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UQ_vaccineWhodrug_drugCode" UNIQUE ("drugCode")
);
CREATE INDEX IF NOT EXISTS "IX_vaccineWhodrug_name" ON "vaccineWhodrug" USING gin (to_tsvector('simple', coalesce("drugName", '')));

CREATE TABLE IF NOT EXISTS "diluentCatalog" (
  "diluentCatalogId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) UNIQUE,
  "name" varchar(250) NOT NULL,
  "description" text,
  "composition" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- -----------------------------------------------------------------------------
-- Core case model
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "patient" (
  "patientId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firstName" varchar(150),
  "middleName" varchar(150),
  "lastName" varchar(150),
  "secondLastName" varchar(150),
  "birthDate" date,
  "documentNumber" varchar(100),
  "passportNumber" varchar(100),
  "email" citext,
  "phoneNumber" varchar(50),
  "healthSystemCode" varchar(100),
  "sexItemId" uuid,
  "residenceGeoLocationId" uuid,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_patient_sex" FOREIGN KEY ("sexItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_patient_residenceGeo" FOREIGN KEY ("residenceGeoLocationId") REFERENCES "geoLocation" ("geoLocationId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_patient_documentNumber" UNIQUE ("documentNumber")
);
CREATE INDEX IF NOT EXISTS "IX_patient_residenceGeo" ON "patient" ("residenceGeoLocationId");

CREATE TABLE IF NOT EXISTS "esaviCase" (
  "caseId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId" uuid NOT NULL,
  "healthFacilityId" uuid NOT NULL,
  "caseCode" varchar(200) NOT NULL,
  "reportDate" date NOT NULL DEFAULT current_date,
  "eventDate" date,
  "countryIsoCode" varchar(5),
  "reportFillingDate" date,
  "notificationOrganization" varchar(250),
  "details" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_esaviCase_patient" FOREIGN KEY ("patientId") REFERENCES "patient" ("patientId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_esaviCase_healthFacility" FOREIGN KEY ("healthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_esaviCase_caseCode" UNIQUE ("caseCode")
);
CREATE INDEX IF NOT EXISTS "IX_esaviCase_patient" ON "esaviCase" ("patientId");
CREATE INDEX IF NOT EXISTS "IX_esaviCase_reportDate" ON "esaviCase" ("reportDate");

CREATE TABLE IF NOT EXISTS "notifier" (
  "notifierId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" uuid NOT NULL,
  "healthFacilityId" uuid,
  "professionItemId" uuid,
  "firstName" varchar(150) NOT NULL,
  "lastName" varchar(150),
  "room" varchar(50),
  "address" varchar(250),
  "phoneNumber" varchar(50),
  "email" citext,
  "details" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notifier_case" FOREIGN KEY ("caseId") REFERENCES "esaviCase" ("caseId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notifier_healthFacility" FOREIGN KEY ("healthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_notifier_profession" FOREIGN KEY ("professionItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_notifier_case" ON "notifier" ("caseId");

CREATE TABLE IF NOT EXISTS "classification" (
  "classificationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" uuid NOT NULL,
  "age" smallint CHECK ("age" IS NULL OR "age" >= 0),
  "ageUnitItemId" uuid,
  "firstConsultationDate" date,
  "isSeriousEvent" "answerOption",
  "causedDeath" "answerOption",
  "causedDisability" "answerOption",
  "causedCongenitalAnomaly" "answerOption",
  "causedFetalDeath" "answerOption",
  "causedLifeThreatening" "answerOption",
  "causedHospitalization" "answerOption",
  "causedAbortion" "answerOption",
  "causedOtherCondition" "answerOption",
  "otherSeriousConditionDescription" text,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_classification_case" FOREIGN KEY ("caseId") REFERENCES "esaviCase" ("caseId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_classification_ageUnit" FOREIGN KEY ("ageUnitItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_classification_case" UNIQUE ("caseId")
);

CREATE TABLE IF NOT EXISTS "notification" (
  "notificationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" uuid NOT NULL,
  "notificationType" "notificationType" NOT NULL,
  "hasRelevantMedicalHistory" "answerOption",
  "takesMedication" "answerOption",
  "esaviDescription" text NOT NULL,
  "outcomeItemId" uuid,
  "requestInvestigation" "answerOption",
  "deathDate" date,
  "autopsyRequested" "answerOption",
  "verbalAutopsyPerformed" "answerOption",
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notification_case" FOREIGN KEY ("caseId") REFERENCES "esaviCase" ("caseId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notification_outcome" FOREIGN KEY ("outcomeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_notification_case" UNIQUE ("caseId")
);
CREATE INDEX IF NOT EXISTS "IX_notification_case" ON "notification" ("caseId");

CREATE TABLE IF NOT EXISTS "severeNotification" (
  "notificationId" uuid PRIMARY KEY,
  "hasPreviousEventHistory" "answerOption",
  "hasAllergyToOtherVaccines" "answerOption",
  "hasAllergyToMedications" "answerOption",
  "hasAllergyToPreviousSameVaccine" "answerOption",
  "hasPregnancyComplications" "answerOption",
  "pregnancyComplicationsDescription" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_severeNotification_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "nonSevereNotification" (
  "notificationId" uuid PRIMARY KEY,
  "vaccinationHealthFacilityId" uuid,
  "vaccinationSiteItemId" uuid,
  "vaccinationCenterAddress" varchar(250),
  "vaccinationGeoLocationId" uuid,
  "verifiedPhysicalDocument" "answerOption",
  "verifiedElectronicRecord" "answerOption",
  "verifiedVerbalReport" "answerOption",
  "verifiedClinicalRecord" "answerOption",
  "verifiedUnknown" "answerOption",
  "verifiedOtherSource" "answerOption",
  "otherSourceDescription" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_nonSevereNotification_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_nonSevereNotification_facility" FOREIGN KEY ("vaccinationHealthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_nonSevereNotification_site" FOREIGN KEY ("vaccinationSiteItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_nonSevereNotification_geo" FOREIGN KEY ("vaccinationGeoLocationId") REFERENCES "geoLocation" ("geoLocationId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "notificationEvent" (
  "eventId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL,
  "diagnosticTermId" uuid,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "esaviName" varchar(250) NOT NULL,
  "esaviCode" varchar(250),
  "esaviRawName" varchar(500),
  "isMainEsavi" boolean NOT NULL DEFAULT false,
  "startDate" date,
  "startTime" time,
  "isOtherEsavi" boolean NOT NULL DEFAULT false,
  "otherDescription" varchar(500),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationEvent_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationEvent_diagnosticTerm" FOREIGN KEY ("diagnosticTermId") REFERENCES "diagnosticTerm" ("diagnosticTermId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_notificationEvent_notification" ON "notificationEvent" ("notificationId");

CREATE TABLE IF NOT EXISTS "notificationMedication" (
  "medicationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "medicationName" varchar(250) NOT NULL,
  "medicationCode" varchar(250),
  "dose" varchar(100),
  "pharmaceuticalFormItemId" uuid,
  "administrationRouteItemId" uuid,
  "startDate" date,
  "isOtherMedication" boolean NOT NULL DEFAULT false,
  "otherMedicationText" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationMedication_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationMedication_form" FOREIGN KEY ("pharmaceuticalFormItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_notificationMedication_route" FOREIGN KEY ("administrationRouteItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "notificationVaccine" (
  "vaccineId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL,
  "vaccineWhodrugId" uuid,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "isSuspected" "answerOption",
  "whoCode" varchar(250),
  "vaccineCode" varchar(250),
  "vaccineName" varchar(500),
  "vaccinationDate" date,
  "vaccinationTime" time,
  "doseNumber" smallint CHECK ("doseNumber" IS NULL OR "doseNumber" >= 0),
  "batchNumber" varchar(100),
  "expirationDate" date,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationVaccine_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationVaccine_whodrug" FOREIGN KEY ("vaccineWhodrugId") REFERENCES "vaccineWhodrug" ("vaccineWhodrugId") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_notificationVaccine_notification" ON "notificationVaccine" ("notificationId");

CREATE TABLE IF NOT EXISTS "notificationDiluent" (
  "diluentId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vaccineId" uuid NOT NULL,
  "diluentCatalogId" uuid,
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "batchNumber" varchar(250),
  "expirationDate" date,
  "reconstitutionDate" date,
  "reconstitutionTime" time,
  "diluentName" varchar(250),
  "diluentCode" varchar(250),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationDiluent_vaccine" FOREIGN KEY ("vaccineId") REFERENCES "notificationVaccine" ("vaccineId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationDiluent_catalog" FOREIGN KEY ("diluentCatalogId") REFERENCES "diluentCatalog" ("diluentCatalogId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "notificationPregnancy" (
  "pregnancyId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" uuid NOT NULL,
  "wasPregnantAtVaccination" "answerOption",
  "wasPregnantAtEsavi" "answerOption",
  "lastMenstruationDate" date,
  "probableDeliveryDate" date,
  "hasComplications" "answerOption",
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationPregnancy_notification" FOREIGN KEY ("notificationId") REFERENCES "notification" ("notificationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "UQ_notificationPregnancy_notification" UNIQUE ("notificationId")
);

CREATE TABLE IF NOT EXISTS "notificationPregnancyComplication" (
  "complicationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pregnancyId" uuid NOT NULL,
  "diagnosticTermId" uuid,
  "complicationTypeItemId" uuid,
  "complicationRawName" varchar(500),
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_notificationPregnancyComplication_pregnancy" FOREIGN KEY ("pregnancyId") REFERENCES "notificationPregnancy" ("pregnancyId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_notificationPregnancyComplication_term" FOREIGN KEY ("diagnosticTermId") REFERENCES "diagnosticTerm" ("diagnosticTermId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_notificationPregnancyComplication_type" FOREIGN KEY ("complicationTypeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

-- -----------------------------------------------------------------------------
-- Investigation split model
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "investigation" (
  "investigationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" uuid NOT NULL,
  "statusItemId" uuid,
  "vaccinationSiteItemId" uuid,
  "vaccinationHealthFacilityId" uuid,
  "vaccinationGeoLocationId" uuid,
  "hospitalizationDate" date,
  "investigationStartDate" date,
  "vaccinationLatitude" numeric(10,7),
  "vaccinationLongitude" numeric(10,7),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigation_case" FOREIGN KEY ("caseId") REFERENCES "esaviCase" ("caseId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigation_status" FOREIGN KEY ("statusItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigation_vaccinationSite" FOREIGN KEY ("vaccinationSiteItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigation_vaccinationFacility" FOREIGN KEY ("vaccinationHealthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigation_vaccinationGeo" FOREIGN KEY ("vaccinationGeoLocationId") REFERENCES "geoLocation" ("geoLocationId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_investigation_case" UNIQUE ("caseId")
);
CREATE INDEX IF NOT EXISTS "IX_investigation_case" ON "investigation" ("caseId");

CREATE TABLE IF NOT EXISTS "investigationSource" (
  "investigationId" uuid PRIMARY KEY,
  "history" "answerOption",
  "interviewVaccinatedPerson" "answerOption",
  "interviewHealthWorker" "answerOption",
  "vaccinationRecord" "answerOption",
  "autopsyRecord" "answerOption",
  "verbalAutopsyRecord" "answerOption",
  "investigationReport" "answerOption",
  "other" "answerOption",
  "otherDescription" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationSource_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "investigationAutopsy" (
  "investigationId" uuid PRIMARY KEY,
  "isDeath" "answerOption",
  "deathDate" date,
  "deathTime" time,
  "isAutopsyPerformed" "answerOption",
  "isAutopsyScheduled" "answerOption",
  "autopsyDate" date,
  "scheduledAutopsyDate" date,
  "autopsyComments" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationAutopsy_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "investigationTeamMember" (
  "investigationTeamMemberId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigationId" uuid NOT NULL,
  "fullName" varchar(250) NOT NULL,
  "institutionName" varchar(500),
  "email" citext,
  "phone" varchar(50),
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationTeamMember_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "investigationCovidHistory" (
  "investigationId" uuid PRIMARY KEY,
  "hasCovidHistory" "answerOption",
  "hadAsymptomaticCovid" "answerOption",
  "covidSymptomsStartDate" date,
  "covidConfirmationDiagnosisItemId" uuid,
  "covidDiseaseSeverityItemId" uuid,
  "covidSampleDate" date,
  "isOtherCovidConfirmation" boolean NOT NULL DEFAULT false,
  "otherCovidConfirmationDescription" varchar(250),
  "participatedInTrial" "answerOption",
  "highestCovidSeverityLevelItemId" uuid,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationCovidHistory_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationCovidHistory_confirmation" FOREIGN KEY ("covidConfirmationDiagnosisItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationCovidHistory_severity" FOREIGN KEY ("covidDiseaseSeverityItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationCovidHistory_highestSeverity" FOREIGN KEY ("highestCovidSeverityLevelItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationMedicalHistory" (
  "investigationId" uuid PRIMARY KEY,
  "hasPriorHospitalizationHistory" "answerOption",
  "priorHospitalizationObservations" text,
  "hasFamilyHistory" "answerOption",
  "familyHistoryObservations" text,
  "isPregnancyConfirmed" "answerOption",
  "gestationalWeeks" smallint CHECK ("gestationalWeeks" IS NULL OR "gestationalWeeks" BETWEEN 0 AND 45),
  "gestationMethodItemId" uuid,
  "deliveryItemId" uuid,
  "birthItemId" uuid,
  "pregnancyOutcomeItemId" uuid,
  "hasPregnancyRiskFactor" "answerOption",
  "riskFactorDescription" text,
  "birthWeightGrams" numeric(8,2) CHECK ("birthWeightGrams" IS NULL OR "birthWeightGrams" >= 0),
  "wasBreastfed" "answerOption",
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationMedicalHistory_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationMedicalHistory_gestationMethod" FOREIGN KEY ("gestationMethodItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationMedicalHistory_delivery" FOREIGN KEY ("deliveryItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationMedicalHistory_birth" FOREIGN KEY ("birthItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationMedicalHistory_pregnancyOutcome" FOREIGN KEY ("pregnancyOutcomeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationPregnancyCondition" (
  "pregnancyConditionId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigationId" uuid NOT NULL,
  "diagnosticTermId" uuid,
  "conditionRaw" varchar(500),
  "sortOrder" smallint NOT NULL DEFAULT 0 CHECK ("sortOrder" >= 0),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationPregnancyCondition_medicalHistory" FOREIGN KEY ("investigationId") REFERENCES "investigationMedicalHistory" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationPregnancyCondition_term" FOREIGN KEY ("diagnosticTermId") REFERENCES "diagnosticTerm" ("diagnosticTermId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationClinicalEvaluation" (
  "investigationId" uuid PRIMARY KEY,
  "receivedMedicalAttention" "answerOption",
  "sourceExam" "answerOption",
  "sourceDocuments" "answerOption",
  "sourceVerbalAutopsy" "answerOption",
  "sourceOther" "answerOption",
  "otherDescription" text,
  "suspectedChildAbuse" "answerOption",
  "childAbuseExplanation" text,
  "suspectedDomesticViolence" "answerOption",
  "domesticViolenceExplanation" text,
  "clinicalDetailsPersonName" text,
  "familyClinicalDetails" text,
  "completeClinicalSummary" text,
  "signsAndSymptoms" text,
  "otherSocialBackground" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationClinicalEvaluation_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "evaluationInstitution" (
  "evaluationInstitutionId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigationId" uuid NOT NULL,
  "sortOrder" smallint CHECK ("sortOrder" IS NULL OR "sortOrder" >= 0),
  "healthFacilityId" uuid,
  "institutionName" varchar(250),
  "personName" varchar(250),
  "personContact" varchar(250),
  "evaluationInstitutionTypeItemId" uuid,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_evaluationInstitution_clinicalEvaluation" FOREIGN KEY ("investigationId") REFERENCES "investigationClinicalEvaluation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_evaluationInstitution_facility" FOREIGN KEY ("healthFacilityId") REFERENCES "healthFacility" ("healthFacilityId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_evaluationInstitution_type" FOREIGN KEY ("evaluationInstitutionTypeItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationVaccinationContext" (
  "investigationId" uuid PRIMARY KEY,
  "momentItemId" uuid,
  "multidoseItemId" uuid,
  "vaccinatedPerVialCount" smallint CHECK ("vaccinatedPerVialCount" IS NULL OR "vaccinatedPerVialCount" >= 0),
  "vaccinatedPerBatchCount" smallint CHECK ("vaccinatedPerBatchCount" IS NULL OR "vaccinatedPerBatchCount" >= 0),
  "locations" text,
  "isCluster" "answerOption",
  "clusterIdentificationNumber" varchar(100),
  "clusterAdditionalCaseCount" smallint CHECK ("clusterAdditionalCaseCount" IS NULL OR "clusterAdditionalCaseCount" >= 0),
  "clusterUsedSameVial" "answerOption",
  "clusterSameVialCount" smallint CHECK ("clusterSameVialCount" IS NULL OR "clusterSameVialCount" >= 0),
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationVaccinationContext_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationVaccinationContext_moment" FOREIGN KEY ("momentItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_investigationVaccinationContext_multidose" FOREIGN KEY ("multidoseItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationVaccineAdministered" (
  "vaccineAdministeredId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investigationId" uuid NOT NULL,
  "sortOrder" smallint CHECK ("sortOrder" IS NULL OR "sortOrder" >= 0),
  "vaccineWhodrugId" uuid,
  "doseNumber" smallint CHECK ("doseNumber" IS NULL OR "doseNumber" >= 0),
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationVaccineAdministered_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_investigationVaccineAdministered_whodrug" FOREIGN KEY ("vaccineWhodrugId") REFERENCES "vaccineWhodrug" ("vaccineWhodrugId") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "investigationColdChain" (
  "investigationId" uuid PRIMARY KEY,
  "storageTemperatureMonitored" "answerOption",
  "storageRangeDeviation" "answerOption",
  "storageProcedureFollowed" "answerOption",
  "storageOtherObjectPresent" "answerOption",
  "storagePartiallyReconstitutedVaccine" "answerOption",
  "storageVaccineNotUsable" "answerOption",
  "storageDiluentNotUsable" "answerOption",
  "storageKeyFindings" text,
  "transportUsedThermos" "answerOption",
  "transportSetInThermos" "answerOption",
  "transportReturnedInThermos" "answerOption",
  "transportUsedColdPack" "answerOption",
  "transportTypeThermo" varchar(250),
  "transportKeyFindings" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationColdChain_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "investigationAdministrationError" (
  "investigationId" uuid PRIMARY KEY,
  "usedAutoDisableSyringes" "answerOption",
  "usedGlassSyringes" "answerOption",
  "usedDisposableSyringes" "answerOption",
  "usedRecycledDisposableSyringes" "answerOption",
  "usedOtherSyringes" "answerOption",
  "otherSyringesDescription" text,
  "syringesKeyFindings" text,
  "reconstitutionUsedSameSyringe" "answerOption",
  "reconstitutionUsedSameSyringeDifferentVaccine" "answerOption",
  "reconstitutionUsedDifferentSyringeSameVial" "answerOption",
  "reconstitutionUsedDifferentSyringeDifferentVaccine" "answerOption",
  "reconstitutionFollowedManufacturerRecommendation" "answerOption",
  "reconstitutionKeyFindings" text,
  "hadPrescriptionError" "answerOption",
  "prescriptionErrorNotes" text,
  "hadContaminatedVaccine" "answerOption",
  "contaminatedVaccineNotes" text,
  "hadAbnormalVaccineConditions" "answerOption",
  "abnormalConditionsNotes" text,
  "hadPreparationError" "answerOption",
  "preparationErrorNotes" text,
  "hadHandlingError" "answerOption",
  "handlingErrorNotes" text,
  "hadImproperAdministration" "answerOption",
  "improperAdministrationNotes" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationAdministrationError_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "investigationCommunity" (
  "investigationId" uuid PRIMARY KEY,
  "patientLatitude" numeric(10,7),
  "patientLongitude" numeric(10,7),
  "hadSimilarEvent" "answerOption",
  "similarEventDescription" text,
  "similarEventCount" smallint CHECK ("similarEventCount" IS NULL OR "similarEventCount" >= 0),
  "affectedVaccinated" smallint CHECK ("affectedVaccinated" IS NULL OR "affectedVaccinated" >= 0),
  "affectedUnvaccinated" smallint CHECK ("affectedUnvaccinated" IS NULL OR "affectedUnvaccinated" >= 0),
  "affectedUnknown" smallint CHECK ("affectedUnknown" IS NULL OR "affectedUnknown" >= 0),
  "otherComments" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_investigationCommunity_investigation" FOREIGN KEY ("investigationId") REFERENCES "investigation" ("investigationId") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "finalClassification" (
  "finalClassificationId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "caseId" uuid NOT NULL,
  "importanceAItemId" uuid,
  "importanceBItemId" uuid,
  "importanceCItemId" uuid,
  "aIsRelatedToVaccineProduct" "answerOption",
  "aIsRelatedToQualityDeviation" "answerOption",
  "aIsRelatedToProgrammaticError" "answerOption",
  "aIsRelatedToStress" "answerOption",
  "bIsConsistentTemporalRelation" "answerOption",
  "bHasDeterminantFactor" "answerOption",
  "cHasCoincidentCause" "answerOption",
  "dIsUnclassifiable" "answerOption",
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT current_timestamp,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz,
  "sysDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appDetails" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "FK_finalClassification_case" FOREIGN KEY ("caseId") REFERENCES "esaviCase" ("caseId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "FK_finalClassification_importanceA" FOREIGN KEY ("importanceAItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_finalClassification_importanceB" FOREIGN KEY ("importanceBItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "FK_finalClassification_importanceC" FOREIGN KEY ("importanceCItemId") REFERENCES "catalogItem" ("catalogItemId") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "UQ_finalClassification_case" UNIQUE ("caseId")
);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'sysDetails'
    GROUP BY table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'TRG_' || r.table_name || '_setUpdatedAt', r.table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'TRG_' || r.table_name || '_setSysDetails', r.table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "setSysDetails"()', 'TRG_' || r.table_name || '_setSysDetails', r.table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS "TRG_healthFacility_validateCatalogs" ON "healthFacility";
CREATE TRIGGER "TRG_healthFacility_validateCatalogs"
BEFORE INSERT OR UPDATE OF "facilityTypeItemId" ON "healthFacility"
FOR EACH ROW EXECUTE FUNCTION "trgValidateHealthFacilityCatalogs"();

-- Auto-assign sortOrder for transactional child tables where row order matters.
-- If sortOrder is NULL or 0, it is assigned as MAX(sortOrder) + 1 within the same parent.
DO $$
DECLARE
  cfg record;
BEGIN
  FOR cfg IN
    SELECT * FROM (VALUES
      ('notificationEvent', 'notificationId'),
      ('notificationMedication', 'notificationId'),
      ('notificationVaccine', 'notificationId'),
      ('notificationDiluent', 'vaccineId'),
      ('notificationPregnancyComplication', 'pregnancyId'),
      ('investigationTeamMember', 'investigationId'),
      ('investigationPregnancyCondition', 'investigationId'),
      ('evaluationInstitution', 'investigationId'),
      ('investigationVaccineAdministered', 'investigationId')
    ) AS v(table_name, parent_column)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'TRG_' || cfg.table_name || '_setSortOrder', cfg.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION "setSortOrderByParent"(%L)',
      'TRG_' || cfg.table_name || '_setSortOrder',
      cfg.table_name,
      cfg.parent_column
    );
  END LOOP;
END $$;

-- Enforce non-duplicated order within the same parent for active child rows.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationEvent_parent_sortOrder"
  ON "notificationEvent" ("notificationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationMedication_parent_sortOrder"
  ON "notificationMedication" ("notificationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationVaccine_parent_sortOrder"
  ON "notificationVaccine" ("notificationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationDiluent_parent_sortOrder"
  ON "notificationDiluent" ("vaccineId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notificationPregnancyComplication_parent_sortOrder"
  ON "notificationPregnancyComplication" ("pregnancyId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_investigationTeamMember_parent_sortOrder"
  ON "investigationTeamMember" ("investigationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_investigationPregnancyCondition_parent_sortOrder"
  ON "investigationPregnancyCondition" ("investigationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_evaluationInstitution_parent_sortOrder"
  ON "evaluationInstitution" ("investigationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_investigationVaccineAdministered_parent_sortOrder"
  ON "investigationVaccineAdministered" ("investigationId", "sortOrder")
  WHERE "deletedAt" IS NULL AND "sortOrder" IS NOT NULL;


-- Prevent accidental physical deletes on master/core tables. Use soft-delete procedures instead.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalogType', 'catalogItem', 'geoLevelType', 'geoLocation', 'healthFacility',
    'diagnosticTerm', 'vaccineWhodrug', 'diluentCatalog', 'patient', 'esaviCase',
    'appUser', 'appRole', 'appPermission', 'appUserRole', 'appRolePermission',
    'appSession', 'systemConfig', 'systemConfigHistory'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'TRG_' || t || '_preventPhysicalDelete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "preventPhysicalDelete"()', 'TRG_' || t || '_preventPhysicalDelete', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Stored procedures / helper functions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "createEsaviCase"(
  "pPatientId" uuid,
  "pCaseCode" varchar,
  "pReportDate" date DEFAULT current_date,
  "pEventDate" date DEFAULT NULL,
  "pCountryIsoCode" varchar DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_case_id uuid;
BEGIN
  INSERT INTO "esaviCase" ("patientId", "caseCode", "reportDate", "eventDate", "countryIsoCode")
  VALUES ("pPatientId", "pCaseCode", COALESCE("pReportDate", current_date), "pEventDate", "pCountryIsoCode")
  RETURNING "caseId" INTO v_case_id;

  RETURN v_case_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE "softDeleteEsaviCase"("pCaseId" uuid)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "esaviCase"
  SET "deletedAt" = current_timestamp, "isActive" = false
  WHERE "caseId" = "pCaseId" AND "deletedAt" IS NULL;
END;
$$;

CREATE OR REPLACE PROCEDURE "softDeleteRecord"(
  "pTableName" text,
  "pPrimaryKeyColumn" text,
  "pPrimaryKeyValue" uuid,
  "pActor" text DEFAULT NULL,
  "pReason" text DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sql text;
BEGIN
  v_sql := format(
    'UPDATE %I
     SET "deletedAt" = current_timestamp,
         "sysDetails" = COALESCE("sysDetails", ''{}''::jsonb) || jsonb_build_object(
           ''request'', jsonb_build_object(''username'', $2, ''reason'', $3)
         )
     WHERE %I = $1 AND "deletedAt" IS NULL',
    "pTableName",
    "pPrimaryKeyColumn"
  );

  EXECUTE v_sql USING "pPrimaryKeyValue", "pActor", "pReason";
END;
$$;

CREATE OR REPLACE FUNCTION "getGeoLocationPath"("pGeoLocationId" uuid)
RETURNS TABLE(
  "geoLocationId" uuid,
  "name" varchar,
  "levelCode" varchar,
  "depth" integer
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE path AS (
    SELECT gl."geoLocationId", gl."parentGeoLocationId", gl."name", glt."code" AS "levelCode", 0 AS depth
    FROM "geoLocation" gl
    JOIN "geoLevelType" glt ON glt."geoLevelTypeId" = gl."geoLevelTypeId"
    WHERE gl."geoLocationId" = "pGeoLocationId"
    UNION ALL
    SELECT parent."geoLocationId", parent."parentGeoLocationId", parent."name", parentType."code", path.depth + 1
    FROM "geoLocation" parent
    JOIN path ON path."parentGeoLocationId" = parent."geoLocationId"
    JOIN "geoLevelType" parentType ON parentType."geoLevelTypeId" = parent."geoLevelTypeId"
  )
  SELECT path."geoLocationId", path."name", path."levelCode", path.depth
  FROM path
  ORDER BY path.depth DESC;
END;
$$ LANGUAGE plpgsql STABLE;

DROP PROCEDURE IF EXISTS "upsertCatalogItem"(varchar, varchar, varchar, varchar, varchar, smallint);
DROP PROCEDURE IF EXISTS "upsertCatalogItem"(varchar, varchar, varchar, varchar, varchar, integer);
DROP PROCEDURE IF EXISTS "upsertCatalogItem"(text, text, text, text, text, integer);

CREATE OR REPLACE PROCEDURE "upsertCatalogItem"(
  "pCatalogTypeCode" varchar,
  "pCatalogTypeName" varchar,
  "pItemCode" varchar,
  "pItemName" varchar,
  "pItemValue" varchar DEFAULT NULL,
  "pSortOrder" integer DEFAULT 0
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_catalog_type_id uuid;
BEGIN
  INSERT INTO "catalogType" ("code", "name")
  VALUES ("pCatalogTypeCode", "pCatalogTypeName")
  ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name"
  RETURNING "catalogTypeId" INTO v_catalog_type_id;

  INSERT INTO "catalogItem" ("catalogTypeId", "code", "name", "value", "sortOrder")
  VALUES (v_catalog_type_id, "pItemCode", "pItemName", COALESCE("pItemValue", "pItemCode"), COALESCE("pSortOrder", 0))
  ON CONFLICT ("catalogTypeId", "code") DO UPDATE
  SET "name" = EXCLUDED."name",
      "value" = EXCLUDED."value",
      "sortOrder" = EXCLUDED."sortOrder",
      "isActive" = true,
      "deletedAt" = NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- Application administration helper procedures
-- -----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE "upsertSystemConfig"(
  "pCode" varchar,
  "pName" varchar,
  "pValue" jsonb,
  "pScope" varchar DEFAULT 'GLOBAL',
  "pValueType" varchar DEFAULT 'json',
  "pDescription" text DEFAULT NULL,
  "pChangedByUserId" uuid DEFAULT NULL,
  "pChangeReason" text DEFAULT NULL,
  "pAppDetails" jsonb DEFAULT '{}'::jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_config_id uuid;
  v_previous_value jsonb;
BEGIN
  SELECT "systemConfigId", "value"
  INTO v_config_id, v_previous_value
  FROM "systemConfig"
  WHERE "code" = "pCode"
    AND "scope" = COALESCE("pScope", 'GLOBAL')
    AND "deletedAt" IS NULL;

  IF v_config_id IS NULL THEN
    INSERT INTO "systemConfig" ("code", "name", "description", "value", "scope", "valueType", "appDetails")
    VALUES ("pCode", "pName", "pDescription", COALESCE("pValue", '{}'::jsonb), COALESCE("pScope", 'GLOBAL'), COALESCE("pValueType", 'json'), COALESCE("pAppDetails", '{}'::jsonb))
    RETURNING "systemConfigId" INTO v_config_id;
  ELSE
    UPDATE "systemConfig"
    SET "name" = "pName",
        "description" = COALESCE("pDescription", "description"),
        "value" = COALESCE("pValue", '{}'::jsonb),
        "valueType" = COALESCE("pValueType", "valueType"),
        "appDetails" = COALESCE("pAppDetails", "appDetails")
    WHERE "systemConfigId" = v_config_id;
  END IF;

  INSERT INTO "systemConfigHistory" ("systemConfigId", "previousValue", "newValue", "changedByUserId", "changeReason", "appDetails")
  VALUES (v_config_id, v_previous_value, COALESCE("pValue", '{}'::jsonb), "pChangedByUserId", "pChangeReason", COALESCE("pAppDetails", '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION "getUserPermissions"("pUserId" uuid)
RETURNS TABLE(
  "permissionCode" varchar,
  "module" varchar,
  "action" varchar
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT p."code", p."module", p."action"
  FROM "appUserRole" ur
  JOIN "appRole" r ON r."roleId" = ur."roleId"
  JOIN "appRolePermission" rp ON rp."roleId" = r."roleId" AND rp."isAllowed" = true
  JOIN "appPermission" p ON p."permissionId" = rp."permissionId"
  WHERE ur."userId" = "pUserId"
    AND ur."deletedAt" IS NULL
    AND ur."isActive" = true
    AND (ur."validTo" IS NULL OR ur."validTo" > current_timestamp)
    AND r."deletedAt" IS NULL
    AND r."isActive" = true
    AND rp."deletedAt" IS NULL
    AND p."deletedAt" IS NULL
    AND p."isActive" = true;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- Minimal seed catalog types and items
-- -----------------------------------------------------------------------------
CALL "upsertCatalogItem"('ageUnit', 'Age unit', 'YEARS', 'Years', 'YEARS', 1);
CALL "upsertCatalogItem"('ageUnit', 'Age unit', 'MONTHS', 'Months', 'MONTHS', 2);
CALL "upsertCatalogItem"('ageUnit', 'Age unit', 'DAYS', 'Days', 'DAYS', 3);
CALL "upsertCatalogItem"('sex', 'Sex', 'FEMALE', 'Female', 'FEMALE', 1);
CALL "upsertCatalogItem"('sex', 'Sex', 'MALE', 'Male', 'MALE', 2);
CALL "upsertCatalogItem"('sex', 'Sex', 'UNKNOWN', 'Unknown', 'UNKNOWN', 3);
CALL "upsertCatalogItem"('healthFacilityType', 'Health facility type', 'HOSPITAL', 'Hospital', 'HOSPITAL', 1);
CALL "upsertCatalogItem"('healthFacilityType', 'Health facility type', 'HEALTH_CENTER', 'Health center', 'HEALTH_CENTER', 2);
CALL "upsertCatalogItem"('healthFacilityType', 'Health facility type', 'CLINIC', 'Clinic', 'CLINIC', 3);
CALL "upsertCatalogItem"('healthFacilityType', 'Health facility type', 'LABORATORY', 'Laboratory', 'LABORATORY', 4);
CALL "upsertCatalogItem"('healthFacilityType', 'Health facility type', 'VACCINATION_POST', 'Vaccination post', 'VACCINATION_POST', 5);
CALL "upsertCatalogItem"('userStatus', 'User status', 'ACTIVE', 'Active', 'ACTIVE', 1);
CALL "upsertCatalogItem"('userStatus', 'User status', 'INACTIVE', 'Inactive', 'INACTIVE', 2);
CALL "upsertCatalogItem"('userStatus', 'User status', 'LOCKED', 'Locked', 'LOCKED', 3);
CALL "upsertCatalogItem"('userStatus', 'User status', 'PENDING_ACTIVATION', 'Pending activation', 'PENDING_ACTIVATION', 4);
CALL "upsertCatalogItem"('investigationStatus', 'Investigation status', 'NOT_STARTED', 'Not started', 'NOT_STARTED', 1);
CALL "upsertCatalogItem"('investigationStatus', 'Investigation status', 'IN_PROGRESS', 'In progress', 'IN_PROGRESS', 2);
CALL "upsertCatalogItem"('investigationStatus', 'Investigation status', 'CLOSED', 'Closed', 'CLOSED', 3);
CALL "upsertCatalogItem"('outcome', 'Outcome', 'RECOVERED', 'Recovered', 'RECOVERED', 1);
CALL "upsertCatalogItem"('outcome', 'Outcome', 'RECOVERING', 'Recovering', 'RECOVERING', 2);
CALL "upsertCatalogItem"('outcome', 'Outcome', 'NOT_RECOVERED', 'Not recovered', 'NOT_RECOVERED', 3);
CALL "upsertCatalogItem"('outcome', 'Outcome', 'DEATH', 'Death', 'DEATH', 4);
CALL "upsertCatalogItem"('administrationRoute', 'Administration route', 'INTRAMUSCULAR', 'Intramuscular', 'INTRAMUSCULAR', 1);
CALL "upsertCatalogItem"('administrationRoute', 'Administration route', 'SUBCUTANEOUS', 'Subcutaneous', 'SUBCUTANEOUS', 2);
CALL "upsertCatalogItem"('pharmaceuticalForm', 'Pharmaceutical form', 'SOLUTION', 'Solution', 'SOLUTION', 1);
CALL "upsertCatalogItem"('pharmaceuticalForm', 'Pharmaceutical form', 'SUSPENSION', 'Suspension', 'SUSPENSION', 2);

COMMIT;
