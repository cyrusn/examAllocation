# Examination Allocation Programme

## Reminder

- Order
  - Subject and Form Related rank first
  - Higher lesson number first
  - TA helps SEN more

## Binding Rules

The system automatically groups certain classes to share invigilators, but you can override this behavior using the `binding` column in the `examinations` sheet.

1.  **Auto-Binding (Default):**
    *   Exams in the same row that share the same room are automatically bound together.
    *   **SEN Classes** (`S`, `SR`, `ST`) in the same room are automatically bound together for the **entire day** (across all sessions). Leave the binding column empty.

2.  **Explicit Binding (Row ID):**
    *   To manually share invigilators with another class, enter its **Row ID** (e.g., `10`) in the binding column.
    *   The system will bind them as long as they are in the **same room**, even if they are in different sessions. If the rooms don't match, the binding is ignored.

3.  **Breaking Auto-Bindings (`false`):**
    *   If you want to force a class to have its own separate invigilators, enter `false` in the binding column.
    *   **Example:** You have SEN classes in Rm 302 for Session 1 and Session 2. By default, they share an invigilator for the whole day. If you want a *new* invigilator for Session 2, enter `false` in Session 2's binding column.
    *   **Example (Split then Bind):** If you have multiple SEN classes in Session 2 (e.g., 5S, 5SR) and you want a new invigilator for the afternoon, but you still want 5S and 5SR to share that new person:
        *   Row 20 (Session 2, 5S): Enter `false` (breaks the whole-day link).
        *   Row 21 (Session 2, 5SR): Enter `20` (explicitly binds it to the new 5S group).

# workingAllocation
