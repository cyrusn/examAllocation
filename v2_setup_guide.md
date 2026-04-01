# Examination Allocation (v2) Setup Guide

This guide details the requirements to configure the Google Sheets data source and the local environment for the Examination Allocation (v2) script.

## Prerequisites

1. **Node.js** installed on your system.
2. A `.env` file located in the root directory containing the Google Sheet ID:
   ```env
   SPREADSHEET_ID=your_google_sheet_id_here
   ```
3. A Google Service Account credentials file named `.env.key.json` located in the root directory. Ensure the Service Account has the appropriate scopes enabled (Spreadsheets, Calendar, Drive) and has "Editor" access to the Google Sheet.

---

## Google Sheets Configuration

The core logic of the v2 script retrieves data from four specific sheets within the Google Spreadsheet. 

**Critical Rule:** The first row of each sheet **must** contain exactly these header names. They are case-sensitive and serve as keys for mapping the data within the application.

### 1. Sheet Name: `exam`
*Range Fetched: `A:O`*

This sheet contains all examination sessions scheduled for allocation.

**Headers required in Row 1:**
- **`binding`** *(String)*: Binding IDs to group split classes or connected exams together.
- **`id`** *(String/Number)*: A unique identifier for the examination.
- **`classlevel`** *(String)*: The form level (e.g., `S1`, `S2`, `G`, `SB`). Note: `G` and `SB` are assigned 1 default invigilator.
- **`classcodes`** *(String)*: Specific classes taking the exam (e.g., `1A, 1B`).
- **`title`** *(String)*: The name of the subject or duty (e.g., `Chinese Language`, `Guidance Duty`).
- **`session`** *(Number)*: The examination session sequence.
- **`startDateTime`** *(ISO 8601 String)*: The absolute start time (e.g., `2026-01-06T08:15:00+08:00`).
- **`duration`** *(Number)*: The duration of the exam in minutes. (SEN classes with classcodes like `*S` or `*SR` are given extended duration limits).
- **`locations`** *(String)*: The location/room (e.g., `HALL`, `Gym`, `201`).
- **`requiredInvigilators`** *(Number/String)*: The exact number of invigilators required. If left blank, the script will infer the count based on the rules in `v2/config.js`.
- **`paperInCharges`** *(String)*: Pre-assigned paper-in-charge teachers, separated by `|` (e.g., `ABC|DEF`).
- **`invigilators`** *(String)*: Pre-assigned invigilators, separated by `|`.
- **`remark`** *(String)*: Additional remarks.
- **`preferedTeachers`** *(String)*: Preferred teachers for the examination separated by commas.
- **`skip`** *(Boolean/String)*: If `true`, the allocator skips this examination entirely.

---

### 2. Sheet Name: `teachers`
*Range Fetched: `A:E`*

This sheet manages the available teachers and their individual constraints or load configurations.

**Headers required in Row 1:**
- **`teacher`** *(String)*: Unique identifier or initial of the teacher (e.g., `ABC`).
- **`substitutionNumber`** *(Number)*: Baseline load applied to a teacher's total invigilation time score.
- **`maxLoading`** *(Number)*: The maximum occurrence quota limit assigned to this teacher.
- **`isSkip`** *(Boolean)*: If set to `true`, the teacher will not be assigned to any duties by the allocator.
- **`role`** *(String)*: Any specific role tags or identifiers for the teacher.

---

### 3. Sheet Name: `unavailables`
*Range Fetched: `A:C`*

This sheet specifies timeslots where teachers are busy with lessons or other activities. If a planned assignment overlaps with these intervals, it causes a collision validation failure.

**Headers required in Row 1:**
- **`teachers`** *(String)*: Commas-separated initials of teachers (e.g., `ABC, DEF`).
- **`slots`** *(String)*: A comma-separated list of unavailable time blocks, represented as `start_time/end_time` (e.g., `2026-01-06T08:15:00+08:00/2026-01-06T09:15:00+08:00`).
- **`remark`** *(String)*: The reason for being unavailable (e.g., `Lesson`, `Leave`).

---

### 4. Sheet Name: `ignoredUnavailables`
*Range Fetched: `A:D`*

This sheet acts as an override mechanism for collisions detected against the `unavailables` sheet.

**Headers required in Row 1:**
- **`teacher`** *(String)*: The teacher's initial.
- **`start`** *(ISO 8601 String)*: Exact start time of the ignored slot (must perfectly match `unavailables` format).
- **`end`** *(ISO 8601 String)*: Exact end time of the ignored slot.
- **`remark`** *(String)*: Reason for bypassing this validation error.

---

## Configuration Tuning

Before running an allocation pass, review your business logic rules located in:

- **`v2/config.js`**: Contains `INVIGILATOR_RULES` which define fallback parameters for `requiredInvigilators` based on location or class level.
- **`v2/constants.js`**: Holds constants like `BUFFER_TIME`, `F6_BUFFER_TIME`, `TEACHER_ASSISTANTS`, and `DC_TEAM_MEMBERS`. Note that Teacher Assistants and DC Team Members have unique assignment weights logic configured in `v2/logic/core.js`.

## Running the Application

To execute the application:

```bash
node v2/main.js
```

Upon success, you will see a detailed execution log showing validation passes. The generated `result.json` payload and related output scripts (`printStat`, `printView`, `printSen`, `printTeacherView`) will be written to the `./out` directory configured in your constants.