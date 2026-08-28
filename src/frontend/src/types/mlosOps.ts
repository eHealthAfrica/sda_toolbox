import { STATE_OPTIONS } from './h2h'
import type { StateName } from './h2h'

export { STATE_OPTIONS }
export type { StateName }

export type MlosOperationMode = 'standardize' | 'fixer' | 'update'

// POST /qc/standardize (toolbox/apps/mlos/standardizer.py) — the only
// parameter is `mlos_file_path: UploadFile`, a required form field.
export interface StandardizeFormInput {
  mlosFile: File | null
}

// PATCH /qc/fixer (toolbox/apps/mlos/fixer.py). `settlement_file` is the only
// form field; `shift_points`/`set_global_id`/`populate_takeoff`/
// `duplicate_check`/`state` are all bare scalar/enum params with no
// File()/Form()/Query() annotation, so — same repo convention as
// /qc/validation's `state` and /validation's `method` — they're Query
// params on the URL, not part of the multipart body. `state` is only
// actually required by the backend when `shift_points` is true (it raises
// InvalidInputError otherwise), not unconditionally like on /qc/validation.
export interface FixerFormInput {
  settlementFile: File | null
  shiftPoints: boolean
  setGlobalId: boolean
  populateTakeoff: boolean
  duplicateCheck: boolean
  state: StateName | null
}

// Mirrors toolbox/models/__init__.py::Policy — the reason/source used to
// pick which attribute-remapping table the update pulls from
// (toolbox/mlos/validation/update/update.py::map_attribute_relationship).
export const POLICY_OPTIONS = ['MLOS', 'MP'] as const
export type PolicyOption = (typeof POLICY_OPTIONS)[number]

// PATCH /mlos/validation (toolbox/apps/mlos/update_validation.py).
// `mlos_file` is a bare UploadFile (form field). `lga_validation_files` is
// `list[UploadFile] | UploadFile` — still File-like, so also a form field;
// each file is appended under the same `lga_validation_files` key. `purpose`
// is a bare `Policy` enum with no annotation, so — same convention as
// above — it's a Query param, not a form field.
export interface UpdateValidationFormInput {
  mlosFile: File | null
  lgaValidationFiles: File[]
  purpose: PolicyOption | null
}

export type MlosOpsRecord = Record<string, string | number | null>

export interface ParsedMlosOpsDataset {
  records: MlosOpsRecord[]
  columns: string[]
}
