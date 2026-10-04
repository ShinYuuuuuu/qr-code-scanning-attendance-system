ALTER TABLE "Student" ADD COLUMN "course" TEXT;
ALTER TABLE "Student" ADD COLUMN "section" TEXT;
CREATE INDEX "Student_yearLevel_course_section_idx" ON "Student"("yearLevel", "course", "section");
