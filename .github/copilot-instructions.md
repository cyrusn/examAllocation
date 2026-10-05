# Copilot Instructions for Examination Allocation

## Running the Application

**Main command:**
```bash
npm run gen
```

This runs `node v2/main.js` and executes the allocation algorithm. The script reads data from Google Sheets, performs invigilator allocation, and outputs results to the `./out` directory.

**With options:**
```bash
node v2/main.js --help                    # Show help information
node v2/main.js --sb-duration 200         # Override standby exam duration (default: 180 minutes)
node v2/main.js -s 150                    # Short flag for --sb-duration
```

## Project Architecture

This is an **invigilator allocation system** for a school examination schedule. The system assigns teachers to invigilation duties based on constraints and preferences.

### Data Flow

1. **Google Sheets** → `googleSheet.js` fetches raw data from 4 sheets
2. **Parser** (`v2/parser.js`) transforms raw data into application objects:
   - Parses teachers with their availability/constraints
   - Parses unavailable time slots (lessons, leave)
   - Parses examinations with binding rules
3. **Allocator** (`v2/allocator.js`) runs the core algorithm:
   - Reorders exams by priority/density/date
   - Uses greedy assignment with backtracking
   - Validates constraints and handles collisions
4. **Output** (`v2/print/`) generates reports for different audiences (statistics, teacher view, SEN breakdown)

### Key Modules

- **`v2/main.js`**: Entry point, orchestration, CLI argument handling
- **`v2/config.js`**: `INVIGILATOR_RULES` — defines how many invigilators each exam needs (by location, class level, SEN status)
- **`v2/constants.js`**: Special groups (`DC_TEAM_MEMBERS`, `TEACHER_ASSISTANTS`), buffer times, timezone
- **`v2/logic/`**:
  - `core.js`: Assignment logic, impact calculation, teacher stats
  - `validation.js`: Validates assignments against constraints
  - `sanitizer.js`: Handles collision resolution
  - `common.js`: Shared utilities for time/availability checks
- **`v2/print/`**: Multiple output formats (printView, printStat, printSen, printTeacherView)
- **`.env` and `.env.key.json`**: Google Sheets credentials (excluded from repo)

## Google Sheets Configuration

Four sheets must exist with **exact header names** (case-sensitive):

### Sheet: `exam`
- `binding`: Exam IDs to group with this exam (e.g., `10` to share with row 10). Use `false` to break auto-bindings. SEN classes auto-bind within same room/day
- `id`: Unique exam identifier (required)
- `classlevel`: Form level (S1–S6, G for guidance, SB for standby, FI for financial/internal)
- `classcodes`: Class codes taking the exam (e.g., `1A, 1B`)
- `title`: Subject/duty name
- `session`: Session number (1, 2, 3, etc.)
- `startDateTime`: ISO 8601 (e.g., `2026-01-06T08:15:00+08:00`)
- `duration`: Duration in minutes (SEN classes auto-extend; see `getSenDuration()` in utils)
- `locations`: Room/location (e.g., `HALL`, `Gym`, `201`)
- `requiredInvigilators`: Number of invigilators needed. Leave blank to auto-calculate from `INVIGILATOR_RULES` in config
- `paperInCharges`: Pre-assigned paper-in-charge teachers, separated by `|`
- `invigilators`: Pre-assigned invigilators, separated by `|`
- `preferedTeachers`: Preferred teachers (incurs 50% penalty if not used; see `PREFERED_RATE`)
- `remark`: Notes
- `skip`: Set to `true` to exclude exam from allocation

### Sheet: `teachers`
- `teacher`: Teacher identifier (e.g., `ABC`, `JT`) — uppercase strings
- `substitutionNumber`: Baseline load applied to total invigilation time
- `maxLoading`: Max occurrence quota for this teacher
- `isSkip`: Set to `true` to skip this teacher
- `role`: Role tag (optional)

### Sheet: `unavailables`
- `teachers`: Comma-separated teacher initials
- `slots`: Comma-separated unavailable blocks as `start_datetime/end_datetime`
- `remark`: Reason (Lesson, Leave, etc.)

### Sheet: `ignoredUnavailables`
- `teacher`: Teacher initial
- `start`: ISO 8601 start time (must match `unavailables`)
- `end`: ISO 8601 end time
- `remark`: Override reason

## Code Conventions

### Teacher Identifiers
- Always uppercase (e.g., `'ABC'`, `'JT'`)
- Special groups defined in `constants.js`:
  - `TEACHER_ASSISTANTS`: ['OLN', 'WHS', 'WYY', 'EC', 'KYY', 'CKL', 'LS']
  - `DC_TEAM_MEMBERS`: ['JT', 'MKC', 'HYH', 'WTN', 'CSC', 'OSL', 'KYL', 'TCL']
  - Both groups have special assignment weighting in `logic/core.js`

### Exam Binding System
- **Auto-binding (SEN)**: Classes like `1S`, `2SR`, `3ST` in the same room automatically bind for the entire day (share one invigilator across sessions)
- **Explicit binding**: Use a Row ID in the `binding` column to manually link exams
- **Break auto-binding**: Use `false` in the `binding` column to force a new invigilator group
- Bindings only work if exams are in the **same room**

### Special Exam Types
Detected by `classlevel` or `title`:
- **SEN**: Classcode matches `/\d{1}S(R|T)?/` (e.g., `1S`, `2SR`, `3ST`) → 2 invigilators by default, extended duration
- **General Duties**: `G` (Guidance) or `SB` (Standby) → 1 invigilator, special time calculation
- **FI**: Financial/Internal duty → tracked separately in teacher stats
- **Morning/Standby**: Detected in title; affects priority ordering

### Datetime Handling
- All times use ISO 8601 format: `YYYY-MM-DDTHH:mm:ss+08:00` (timezone: Asia/Hong_Kong)
- Use Luxon (`DateTime.fromISO()`, `DateTime.plus()`) for all calculations
- Buffer times defined in `constants.js`:
  - `BUFFER_TIME`: 15 minutes (general)
  - `F6_BUFFER_TIME`: 15 minutes (senior forms)

### Invigilator Rules
- Defined in `config.js` under `INVIGILATOR_RULES`
- Rules are checked in order; first match wins
- Use `exam` properties to match: `classlevel`, `classcode`, `title`, `location`, `session`
- Example: Hall exams for S4–S6 need 5 invigilators; SEN exams need 2

### Data Structure Conventions
- `exam.invigilators`: Array of teacher IDs (or `'UNASSIGNED'` placeholder)
- `exam.binding`: String ID or Array of bound exam IDs
- `exam.exams`: Array of assigned exam objects (set by `assignExamToTeacher`)
- `teacher.exams`: Track of exams assigned to a teacher
- Exam impact tracked as: `timeAdded`, `fiDuty`, `sbDuty`, `guidanceDuty`, `senDuty`

### Allocation Algorithm
Located in `v2/allocator.js`:
1. **Reorder exams** by priority (`applyReordering`):
   - Followers (bound exams) last
   - Sort by date, density (heavy days first), exam type, duration
2. **Greedy assignment** with teacher reordering (`getOrderedAvailableTeachers` from `logic/core.js`):
   - Rank available teachers by load balance, duty type, preferences
3. **Validation & collision handling**:
   - Check time overlaps with unavailable slots (`checkOverlapWithUnavailable`)
   - Resolve conflicts via `sanitizeCollisions` if needed
4. **Track unassigned** exams — count remains stable across iterations

## Testing & Validation

No automated test suite exists. Manual validation workflow:
1. Run `npm run gen` to execute allocation
2. Check output in `./out`:
   - `result.json`: Complete allocation data
   - `printView`: Exam-centric view
   - `printStat`: Statistics and load summary
   - `printSen`: SEN exam details
   - `printTeacherView`: Teacher-centric schedule
3. Review `out.log` for warnings/errors
4. Validate against business rules (no collisions, preferences met, load balanced)

## Environment Setup

1. Create `.env` in project root with Google Sheet ID:
   ```env
   SPREADSHEET_ID=your_google_sheet_id_here
   ```

2. Create `.env.key.json` with Google Service Account credentials (must have Spreadsheets, Calendar, Drive scopes and "Editor" access to the sheet)

3. Install dependencies:
   ```bash
   npm install
   ```

## Output Structure

Results written to `./out` (configurable via `OUTPUT_FILE_PATH` in `constants.js`):
- `result.json`: Full allocation payload
- `printView`, `printStat`, `printSen`, `printTeacherView`: Formatted reports
- `out.log`: Execution log with validation notes

## Deprecated Version

`v1/` is an older implementation. Use `v2/` for all new work.
