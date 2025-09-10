/// AI-powered Employee Performance Insight Platform
/// MongoDB Schema Initialization Script
/// Creates/updates collections: employees, performance_metrics, reviews, system_logs
/// Adds $jsonSchema validators and indexes suitable for analytics and Spring Boot integration.
///
/// Usage:
///   mongosh --port <PORT> --eval "const DB_NAME='<db>';" schema/init_schema.js
///
/// Notes:
/// - Script is idempotent; safe to run multiple times.
/// - Uses validationLevel "moderate" and validationAction "error" for safety.
/// - Index creation is resilient to option changes (drops/recreates conflicting indexes).

/* eslint-disable no-undef */
(function () {
  const resolveDbName = () => {
    // Try explicit variable, fall back to environment-style variables, then default "myapp"
    try {
      // mongosh exposes globalThis
      if (typeof globalThis !== 'undefined') {
        if (typeof globalThis.DB_NAME !== 'undefined') return globalThis.DB_NAME;
        if (typeof globalThis.MONGODB_DB !== 'undefined') return globalThis.MONGODB_DB;
      }
    } catch (e) {
      /* ignore */
    }
    return 'myapp';
  };

  const dbName = resolveDbName();
  print(`\n==> Initializing MongoDB schema for database: ${dbName}`);
  const database = db.getSiblingDB(dbName);

  // Helpers

  // PUBLIC_INTERFACE
  function collectionExists(database, name) {
    /** Check whether a collection exists by name in the provided database. */
    return database.getCollectionInfos({ name }).length > 0;
  }

  // PUBLIC_INTERFACE
  function createIndexSafely(collection, keys, options = {}) {
    /** Create an index, dropping an existing conflicting index (by name) if needed. */
    const idxName = options.name;
    try {
      return collection.createIndex(keys, options);
    } catch (e) {
      const msg = (e && (e.errmsg || e.message)) || '';
      const codeName = e && e.codeName;
      const code = e && e.code;
      const isConflict =
        codeName === 'IndexOptionsConflict' ||
        code === 85 ||
        /already exists with different options/i.test(msg) ||
        /options conflict/i.test(msg);

      if (isConflict && idxName) {
        try {
          print(`  - Recreating conflicting index "${idxName}"...`);
          collection.dropIndex(idxName);
          return collection.createIndex(keys, options);
        } catch (dropErr) {
          throw dropErr;
        }
      }
      throw e;
    }
  }

  // PUBLIC_INTERFACE
  function createOrUpdateCollection(database, name, validator, options = {}, indexes = []) {
    /**
     * Create or update a collection with schema validation and indexes.
     * Idempotent:
     *  - If exists: applies validator via collMod.
     *  - If not: creates collection with validator.
     *  - Ensures indexes exist (creates if missing, drops/recreates on option conflicts).
     */
    const exists = collectionExists(database, name);

    if (!exists) {
      print(`\n[${name}] Creating collection with validator...`);
      database.createCollection(name, {
        validator,
        validationLevel: options.validationLevel || 'moderate',
        validationAction: options.validationAction || 'error',
      });
    } else {
      print(`\n[${name}] Collection exists, applying validator (collMod)...`);
      database.runCommand({
        collMod: name,
        validator,
        validationLevel: options.validationLevel || 'moderate',
        validationAction: options.validationAction || 'error',
      });
    }

    // Ensure indexes
    const coll = database.getCollection(name);
    if (indexes && indexes.length) {
      print(`[${name}] Ensuring ${indexes.length} index(es)...`);
      indexes.forEach((def) => {
        const keys = def.keys;
        const opts = def.options || {};
        createIndexSafely(coll, keys, opts);
      });
      print(`[${name}] Indexes ensured.`);
    }
  }

  // Validators

  const employeesValidator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['employeeId', 'firstName', 'lastName', 'email', 'department', 'hireDate', 'status', 'createdAt', 'updatedAt'],
      properties: {
        employeeId: { bsonType: 'string', description: 'Unique employee identifier (e.g., HRIS ID or slug)' },
        firstName: { bsonType: 'string', minLength: 1 },
        lastName: { bsonType: 'string', minLength: 1 },
        email: {
          bsonType: 'string',
          pattern: '^\\S+@\\S+\\.\\S+$',
          description: 'Employee email address',
        },
        phone: {
          bsonType: ['string', 'null'],
          pattern: '^\\+?[0-9\\-\\s\\(\\)]+$',
          description: 'Optional phone number',
        },
        department: { bsonType: 'string' },
        title: { bsonType: ['string', 'null'] },
        managerId: { bsonType: ['objectId', 'null'], description: 'Reference to employees._id' },
        hireDate: { bsonType: 'date' },
        status: {
          bsonType: 'string',
          enum: ['active', 'inactive', 'on_leave', 'terminated'],
        },
        location: { bsonType: ['string', 'null'] },
        tags: {
          bsonType: ['array'],
          items: { bsonType: 'string' },
          description: 'Arbitrary labels to segment employees',
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  };

  const performanceMetricsValidator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['employeeId', 'metricKey', 'timestamp', 'value', 'createdAt'],
      properties: {
        employeeId: { bsonType: 'objectId', description: 'Reference to employees._id' },
        metricKey: {
          bsonType: 'string',
          pattern: '^[a-zA-Z0-9_\\-\\.]+$',
          description: 'Stable metric key (e.g., productivity, quality)',
        },
        metricName: { bsonType: ['string', 'null'], description: 'Human-friendly metric name' },
        timestamp: { bsonType: 'date', description: 'Point-in-time of metric measurement' },
        period: {
          bsonType: ['string', 'null'],
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
          description: 'Optional period code (YYYY-MM)',
        },
        periodStart: { bsonType: ['date', 'null'] },
        periodEnd: { bsonType: ['date', 'null'] },
        value: { bsonType: ['double', 'int', 'long', 'decimal'], description: 'Raw metric value' },
        score: {
          bsonType: ['double', 'int', 'long', 'decimal', 'null'],
          minimum: 0,
          maximum: 100,
          description: 'Normalized score 0-100',
        },
        target: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
        variance: { bsonType: ['double', 'int', 'long', 'decimal', 'null'] },
        unit: { bsonType: ['string', 'null'] },
        source: {
          bsonType: ['string', 'null'],
          enum: ['system', 'manual', 'ai_model', null],
        },
        tags: {
          bsonType: ['array'],
          items: { bsonType: 'string' },
        },
        meta: { bsonType: ['object', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: ['date', 'null'] },
      },
    },
  };

  const reviewsValidator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['employeeId', 'reviewerId', 'type', 'createdAt'],
      properties: {
        employeeId: { bsonType: 'objectId', description: 'Reference to employees._id' },
        reviewerId: { bsonType: 'objectId', description: 'Reference to reviewer (employee or user) _id' },
        type: {
          bsonType: 'string',
          enum: ['annual', 'quarterly', '360', 'self', 'peer', 'manager'],
        },
        reviewCycle: {
          bsonType: ['string', 'null'],
          pattern: '^\\d{4}-(Q[1-4]|H[12]|FY)$',
          description: 'Cycle identifier: e.g., 2025-Q1, 2025-H2, 2025-FY',
        },
        reviewPeriodStart: { bsonType: ['date', 'null'] },
        reviewPeriodEnd: { bsonType: ['date', 'null'] },
        overallRating: {
          bsonType: ['double', 'int', 'long', 'decimal', 'null'],
          minimum: 0,
          maximum: 5,
        },
        ratings: { bsonType: ['object', 'null'], description: 'Aspect-based ratings (e.g., communication, teamwork)' },
        strengths: {
          bsonType: ['array'],
          items: { bsonType: 'string' },
        },
        areasForImprovement: {
          bsonType: ['array'],
          items: { bsonType: 'string' },
        },
        comments: { bsonType: ['string', 'null'] },
        attachments: {
          bsonType: ['array'],
          items: {
            bsonType: 'object',
            required: ['name', 'url'],
            properties: {
              name: { bsonType: 'string' },
              url: { bsonType: 'string' },
              type: { bsonType: ['string', 'null'] },
            },
          },
        },
        visibility: {
          bsonType: ['string', 'null'],
          enum: ['employee_and_manager', 'manager_only', 'hr_only', null],
        },
        anonymous: { bsonType: ['bool', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: ['date', 'null'] },
      },
    },
  };

  const systemLogsValidator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['level', 'component', 'timestamp', 'message'],
      properties: {
        level: { bsonType: 'string', enum: ['INFO', 'WARN', 'ERROR', 'DEBUG', 'AUDIT'] },
        component: { bsonType: 'string', description: 'e.g., backend_api, frontend_dashboard, performance_db, analytics' },
        timestamp: { bsonType: 'date' },
        message: { bsonType: 'string' },
        userId: { bsonType: ['objectId', 'null'], description: 'User performing the action (if applicable)' },
        context: {
          bsonType: ['object', 'null'],
          properties: {
            requestId: { bsonType: ['string', 'null'] },
            employeeId: { bsonType: ['objectId', 'null'] },
            action: { bsonType: ['string', 'null'] },
            ip: { bsonType: ['string', 'null'] },
            extra: { bsonType: ['object', 'null'] },
          },
        },
        tags: { bsonType: ['array'], items: { bsonType: 'string' } },
        createdAt: { bsonType: ['date', 'null'] },
        expiresAt: { bsonType: ['date', 'null'], description: 'When set, TTL index will auto-expire the document' },
      },
    },
  };

  // Indexes

  const employeesIndexes = [
    { keys: { employeeId: 1 }, options: { name: 'uq_employees_employeeId', unique: true } },
    { keys: { email: 1 }, options: { name: 'uq_employees_email', unique: true, collation: { locale: 'en', strength: 2 } } },
    { keys: { managerId: 1 }, options: { name: 'ix_employees_manager' } },
    { keys: { department: 1 }, options: { name: 'ix_employees_department' } },
    { keys: { status: 1 }, options: { name: 'ix_employees_status' } },
    { keys: { createdAt: -1 }, options: { name: 'ix_employees_createdAt' } },
  ];

  const performanceMetricsIndexes = [
    { keys: { employeeId: 1, metricKey: 1, timestamp: -1 }, options: { name: 'ix_metrics_emp_key_ts' } },
    { keys: { employeeId: 1, periodStart: 1, periodEnd: 1, metricKey: 1 }, options: { name: 'ix_metrics_emp_period_key' } },
    { keys: { metricKey: 1, timestamp: -1 }, options: { name: 'ix_metrics_key_ts' } },
    { keys: { employeeId: 1, createdAt: -1 }, options: { name: 'ix_metrics_emp_createdAt' } },
  ];

  const reviewsIndexes = [
    { keys: { employeeId: 1, reviewPeriodStart: 1, reviewPeriodEnd: 1 }, options: { name: 'ix_reviews_emp_period' } },
    { keys: { reviewerId: 1, createdAt: -1 }, options: { name: 'ix_reviews_reviewer_createdAt' } },
    { keys: { type: 1 }, options: { name: 'ix_reviews_type' } },
    { keys: { createdAt: -1 }, options: { name: 'ix_reviews_createdAt' } },
    { keys: { comments: 'text', strengths: 'text', areasForImprovement: 'text' }, options: { name: 'tx_reviews_text' } },
  ];

  const systemLogsIndexes = [
    { keys: { timestamp: -1 }, options: { name: 'ix_logs_timestamp' } },
    { keys: { level: 1, timestamp: -1 }, options: { name: 'ix_logs_level_ts' } },
    { keys: { component: 1, timestamp: -1 }, options: { name: 'ix_logs_component_ts' } },
    { keys: { 'context.requestId': 1 }, options: { name: 'ix_logs_context_requestId' } },
    { keys: { userId: 1, timestamp: -1 }, options: { name: 'ix_logs_user_ts' } },
    { keys: { 'context.employeeId': 1, timestamp: -1 }, options: { name: 'ix_logs_context_employee_ts' } },
    { keys: { tags: 1 }, options: { name: 'ix_logs_tags' } },
    // TTL index (expireAfterSeconds: 0 means expire at "expiresAt" timestamp)
    { keys: { expiresAt: 1 }, options: { name: 'ttl_logs_expires', expireAfterSeconds: 0 } },
  ];

  // Create/Update collections
  createOrUpdateCollection(database, 'employees', employeesValidator, {}, employeesIndexes);
  createOrUpdateCollection(database, 'performance_metrics', performanceMetricsValidator, {}, performanceMetricsIndexes);
  createOrUpdateCollection(database, 'reviews', reviewsValidator, {}, reviewsIndexes);
  createOrUpdateCollection(database, 'system_logs', systemLogsValidator, {}, systemLogsIndexes);

  print('\n✅ Schema initialization completed successfully.\n');
})();
