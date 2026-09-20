import { Datum } from "./data"
import { Store } from "./store"

import { AddRelative } from "../core/add-relative"
import { RemoveRelative } from "../core/remove-relative"
import { EditTree } from "../core/edit"


export interface FormCreatorSetupProps {
  datum: Datum
  store: Store
  fields: any[]  // todo: Field[]
  postSubmitHandler: (props: any) => void
  onCancel: () => void
  editFirst: boolean
  no_edit: boolean
  link_existing_rel_config?: {linkRelLabel: (d: Datum) => string, title?: string, select_placeholder?: string}
  /** Suppresses the "Profile already exists?" link-existing dropdown for this one form, even
   *  when `link_existing_rel_config` is set - used when the add-relative wizard's "create a
   *  new person" step already made that choice explicitly, so the form shouldn't re-offer it. */
  suppressLinkExisting?: boolean
  onFormCreation: EditTree['onFormCreation']
  addRelative?: AddRelative
  removeRelative?: RemoveRelative
  deletePerson?: () => void
  uploadFile?: (file: File, personId: string) => Promise<string>
  onSubmit?: (e: Event, datum: Datum, applyChanges: () => void, postSubmit: () => void) => void
  onDelete?: (datum: Datum, deletePerson: () => void, postSubmit: (props: any) => void) => void
  canEdit?: (datum: Datum) => boolean
  canDelete?: (datum: Datum) => boolean
}

export interface BaseFormCreator {
  datum_id: string;
  fields: any[];
  onSubmit: (e: any) => void;
  onCancel: () => void;
  onFormCreation: FormCreatorSetupProps['onFormCreation']
  no_edit: boolean;
  uploadFile?: FormCreatorSetupProps['uploadFile']
  gender_field: {
    id: 'gender';
    type: 'switch';
    label: 'Gender';
    initial_value: 'M' | 'F';
    disabled: boolean;
    options: {value: 'M' | 'F'; label: string}[];
  };
  linkExistingRelative?: any;
}

export interface EditDatumFormCreator extends BaseFormCreator {
  onDelete: () => void;
  addRelative: () => void;
  addRelativeCancel: () => void;
  addRelativeActive: boolean;
  removeRelative: () => void;
  removeRelativeCancel: () => void;
  removeRelativeActive: boolean;
  editable: boolean;
  can_delete: boolean;
}

export interface NewRelFormCreator extends BaseFormCreator {
  title: string;
  new_rel: boolean;
  editable: boolean;
}

export type FormCreator = EditDatumFormCreator | NewRelFormCreator;

export interface Field {
  id: string;
  type: string;
  label: string;
  initial_value: string;
  placeholder?: string;
}

export interface RelReferenceField extends Field {
  type: 'rel_reference';
  rel_id: string;
  rel_label: string;
  rel_type: 'spouse';
}

export interface RelReferenceFieldCreator {
  rel_type: 'spouse';
  id: string;
  label: string;
  getRelLabel: (datum: Datum) => string;
}

export interface SelectField extends Field {
  type: 'select';
  options: {value: string; label: string}[];
}

export interface SelectFieldCreator {
  id: string;
  type: 'select';
  label: string;
  placeholder?: string;
  options?: {value: string; label: string}[];
  optionCreator?: (datum: Datum) => {value: string; label: string}[];
}

/** A single-file picker field (e.g. an avatar photo). `initial_value` is the currently
 *  stored URL, if any. Uploading a new file replaces it. */
export interface FileField extends Field {
  type: 'file';
  accept?: string;
}

/** A multi-file picker field (e.g. per-person attachments). `initial_value` is a
 *  JSON-encoded string of `{url, name}[]`, kept as a flat string like every other
 *  `datum.data` value so no schema change is needed elsewhere (export, print, /api/tree). */
export interface FileListField extends Field {
  type: 'file-list';
  accept?: string;
}
