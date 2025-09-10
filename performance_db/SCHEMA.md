# Performance DB Schema (MongoDB)

This document describes the MongoDB schema for the AI-powered Employee Performance Insight Platform. The schema defines collections, validators, and indexes to support transactional usage, analytics, and integration with a Spring Boot REST API.

Contents:
- Collections overview
- Field definitions and validation
- Indexes and query patterns
- Spring Boot (Spring Data MongoDB) integration notes
- Maintenance and operations

## Collections Overview

- employees
  - Stores core employee profiles, reporting structure, and status
- performance_metrics
  - Stores time-stamped and period-based performance metrics and normalized scores
- reviews
  - Stores performance reviews, ratings, comments, and attachments
- system_logs
  - Stores system/application/audit logs with optional TTL expiration

All collections are created with JSON schema validation and appropriate indexes by `schema/init_schema.js`.

## Collection Details

### 1) employees

Required fields:
- employeeId (string, unique)
- firstName (string)
- lastName (string)
- email (string, unique, case-insensitive)
- department (string)
- hireDate (date)
- status (enum: active | inactive | on_leave | terminated)
- createdAt (date), updatedAt (date)

Optional fields:
- phone (string), title (string), managerId (ObjectId -> employees._id), location (string), tags (string[])

Indexes:
- uq_employees_employeeId: { employeeId: 1 } unique
- uq_employees_email: { email: 1 } unique, case-insensitive collation
- ix_employees_manager: { managerId: 1 }
- ix_employees_department: { department: 1 }
- ix_employees_status: { status: 1 }
- ix_employees_createdAt: { createdAt: -1 }

Common queries:
- Find by employeeId or email
- List employees by department, status
- Find directs by managerId

### 2) performance_metrics

Required fields:
- employeeId (ObjectId -> employees._id)
- metricKey (string)
- timestamp (date)
- value (number)
- createdAt (date)

Optional fields:
- metricName (string)
- period (string, YYYY-MM)
- periodStart, periodEnd (date)
- score (number 0-100)
- target, variance (number)
- unit (string)
- source (enum: system | manual | ai_model)
- tags (string[])
- meta (object)
- updatedAt (date)

Indexes:
- ix_metrics_emp_key_ts: { employeeId: 1, metricKey: 1, timestamp: -1 }
- ix_metrics_emp_period_key: { employeeId: 1, periodStart: 1, periodEnd: 1, metricKey: 1 }
- ix_metrics_key_ts: { metricKey: 1, timestamp: -1 }
- ix_metrics_emp_createdAt: { employeeId: 1, createdAt: -1 }

Common queries:
- Time-series trend by employee + metricKey
- Period rollups by employee + period
- Metric-level analytics across employees

Note: For very high write volumes, consider migrating to MongoDB time-series collections (timeField: timestamp, metaField with employeeId + metricKey). Current design uses a standard collection for broad compatibility.

### 3) reviews

Required fields:
- employeeId (ObjectId -> employees._id)
- reviewerId (ObjectId)
- type (enum: annual | quarterly | 360 | self | peer | manager)
- createdAt (date)

Optional fields:
- reviewCycle (string: 2025-Q1, 2025-H2, 2025-FY)
- reviewPeriodStart, reviewPeriodEnd (date)
- overallRating (number 0-5)
- ratings (object: aspect map)
- strengths (string[])
- areasForImprovement (string[])
- comments (string)
- attachments ([{ name, url, type }])
- visibility (enum: employee_and_manager | manager_only | hr_only)
- anonymous (bool)
- updatedAt (date)

Indexes:
- ix_reviews_emp_period: { employeeId: 1, reviewPeriodStart: 1, reviewPeriodEnd: 1 }
- ix_reviews_reviewer_createdAt: { reviewerId: 1, createdAt: -1 }
- ix_reviews_type: { type: 1 }
- ix_reviews_createdAt: { createdAt: -1 }
- tx_reviews_text: text index on comments, strengths, areasForImprovement

Common queries:
- Review history by employee
- Search by text content
- Filter by review type and cycle/period

### 4) system_logs

Required fields:
- level (enum: INFO | WARN | ERROR | DEBUG | AUDIT)
- component (string)
- timestamp (date)
- message (string)

Optional fields:
- userId (ObjectId)
- context (object: requestId, employeeId (ObjectId), action, ip, extra)
- tags (string[])
- createdAt (date)
- expiresAt (date) -> TTL

Indexes:
- ix_logs_timestamp: { timestamp: -1 }
- ix_logs_level_ts: { level: 1, timestamp: -1 }
- ix_logs_component_ts: { component: 1, timestamp: -1 }
- ix_logs_context_requestId: { "context.requestId": 1 }
- ix_logs_user_ts: { userId: 1, timestamp: -1 }
- ix_logs_context_employee_ts: { "context.employeeId": 1, timestamp: -1 }
- ix_logs_tags: { tags: 1 }
- ttl_logs_expires: { expiresAt: 1 } (expireAfterSeconds: 0)

Common queries:
- Audit trails by employee or user
- Error dashboards by component and level
- Request tracing by requestId

## Spring Boot Integration (Spring Data MongoDB)

- Use `@Document(collection = "...")` to map collections.
- Reference IDs as `org.bson.types.ObjectId` (or `String` with converters).
- Prefer immutable DTOs for API layer and separate entity models for persistence.
- For lookups/joins (e.g., managerId), use application-level aggregation as needed.

Example entities (abbreviated):

```java
@Document(collection = "employees")
public class EmployeeDocument {
  @Id private ObjectId id;
  @Indexed(unique = true) private String employeeId;
  @Indexed(collation = "en") private String email;
  private String firstName;
  private String lastName;
  private String department;
  private String title;
  private ObjectId managerId;
  private Date hireDate;
  private String status; // active, inactive, on_leave, terminated
  private String location;
  private List<String> tags;
  private Date createdAt;
  private Date updatedAt;
}
```

```java
@Document(collection = "performance_metrics")
public class PerformanceMetricDocument {
  @Id private ObjectId id;
  @Indexed private ObjectId employeeId;
  @Indexed private String metricKey;
  @Indexed(direction = IndexDirection.DESCENDING) private Date timestamp;
  private String metricName;
  private String period; // YYYY-MM
  private Date periodStart;
  private Date periodEnd;
  private BigDecimal value;
  private BigDecimal score;
  private BigDecimal target;
  private BigDecimal variance;
  private String unit;
  private String source; // system, manual, ai_model
  private List<String> tags;
  private Map<String, Object> meta;
  private Date createdAt;
  private Date updatedAt;
}
```

```java
@Document(collection = "reviews")
public class ReviewDocument {
  @Id private ObjectId id;
  @Indexed private ObjectId employeeId;
  @Indexed private ObjectId reviewerId;
  private String type; // annual, quarterly, 360, self, peer, manager
  private String reviewCycle; // 2025-Q1, 2025-H2, 2025-FY
  private Date reviewPeriodStart;
  private Date reviewPeriodEnd;
  private BigDecimal overallRating;
  private Map<String, Object> ratings;
  private List<String> strengths;
  private List<String> areasForImprovement;
  private String comments;
  private List<Attachment> attachments;
  private String visibility; // employee_and_manager, manager_only, hr_only
  private Boolean anonymous;
  private Date createdAt;
  private Date updatedAt;
}
```

```java
@Document(collection = "system_logs")
public class SystemLogDocument {
  @Id private ObjectId id;
  @Indexed private String level;     // INFO, WARN, ERROR, DEBUG, AUDIT
  @Indexed private String component; // backend_api, frontend_dashboard, performance_db, analytics
  @Indexed(direction = IndexDirection.DESCENDING) private Date timestamp;
  private String message;
  @Indexed private ObjectId userId;
  private LogContext context;
  private List<String> tags;
  private Date createdAt;
  @Indexed(expireAfter = "0s") private Date expiresAt; // using TTL index in MongoDB
}
```

Repository interfaces:
```java
public interface EmployeeRepository extends MongoRepository<EmployeeDocument, ObjectId> {
  Optional<EmployeeDocument> findByEmployeeId(String employeeId);
  Optional<EmployeeDocument> findByEmail(String email);
  List<EmployeeDocument> findByDepartmentAndStatus(String department, String status);
}

public interface PerformanceMetricRepository extends MongoRepository<PerformanceMetricDocument, ObjectId> {
  List<PerformanceMetricDocument> findByEmployeeIdAndMetricKeyAndTimestampBetween(
    ObjectId employeeId, String metricKey, Date start, Date end);
}
```

## Maintenance and Operations

- The schema is initialized by `startup.sh` using `schema/init_schema.js`.
- Index creation is idempotent and handles option conflicts by dropping/recreating the named index.
- The `system_logs` TTL index uses `expiresAt` field: when set in a document, MongoDB will auto-delete it at that time.
- For large datasets and time-series heavy metrics, consider using MongoDB time-series collections and aggregations.

## Running the Initialization Manually

From `performance_db` directory (MongoDB running on DB_PORT):
```bash
mongosh --port 5000 --eval "const DB_NAME='myapp';" schema/init_schema.js
```
