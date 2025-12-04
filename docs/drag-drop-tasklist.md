# Drag & Drop Tasklist (Shared Sortable + Dashboard Custom Sort)

## Scope
- Extract reusable drag-and-drop (DnD) for sortable lists.
- Refactor controller rundown to use it.
- Add “Custom” drag-sort for rooms on the dashboard.
- Preserve undo/redo and placeholder behavior.

## Steps
1) **Shared Sortable Module**
   - Add `useSortableList` (e.g., `frontend/src/hooks/useSortableList.ts`) with `(fromIndex, toIndex)` callback.
   - Add `SortableList`/`SortableItem` components (e.g., `frontend/src/components/sortable/`) exposing handle props and keyboard/pointer support (Enter/Space to drag). Consumer supplies classes; minimal styling; keep deps light (custom or wrap `@dnd-kit`).

2) **Controller Rundown Refactor**
   - Update `frontend/src/components/controller/RundownPanel.tsx` (and timer row handling) to use the shared sortable.
   - Wire to existing `reorderTimer`/`moveTimer`; keep undo/redo and inline undo placeholders.

3) **Dashboard Custom Sort**
   - Add `order` to `Room` (`frontend/src/types/index.ts`).
   - Add `reorderRoom`/`moveRoom` to `DataContext`, `FirebaseDataContext.tsx`, `MockDataContext.tsx` (mirror timer reorder; persist per owner).
   - In `frontend/src/routes/DashboardPage.tsx`: add “Custom” sort; when active, render rooms (and delete placeholders) via the sortable components; persist order on drop.

4) **Styling/Parity**
   - Ensure inline delete placeholders stay aligned within grids/lists for both dashboard and rundown.

5) **Tests**
   - Add unit test for `useSortableList` (reorder callback/index updates).
   - If feasible, add mock-provider test for `reorderRoom` persistence.

6) **Docs**
   - Brief usage note for the sortable hook/components (props, callbacks, handle usage).
   - Note room custom sort + reusable DnD in docs/tasklist.

## Usage Notes
- `useSortableList` consumes `{ items: Array<{ id, value }>, onReorder(from, to) }` and returns `getItemProps` (spread on the list item for drag/drop) plus `getHandleProps` (spread on a grab handle; Enter/Space toggles drag, ArrowUp/ArrowDown moves focus target).
- `SortableList`/`SortableItem` are unstyled `<ul>/<li>` wrappers; consumers supply layout classes and keep placeholders inline.
- Dashboard rooms now support a **Custom** sort that reuses the shared sortable and keeps inline delete placeholders plus undo/redo intact; drops call `reorderRoom` for persistence.
