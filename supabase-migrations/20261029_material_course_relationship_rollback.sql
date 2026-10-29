-- Manual, non-destructive index rollback for 20261029_material_course_relationship.sql.
-- It intentionally retains course_id/is_shared, their FK, and RLS policies:
-- removing those could lose associations or break shared-read security. This
-- removes only supporting indexes and preserves all rows and Storage objects.
begin;

drop index if exists public.study_materials_user_course_created_idx;
drop index if exists public.book_chunks_shared_lookup_idx;

commit;
