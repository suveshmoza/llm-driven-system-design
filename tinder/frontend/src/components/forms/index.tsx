/**
 * Reusable form components.
 * Provides consistent styling and behavior for form inputs across the app.
 */
import React from 'react';

/**
 * Props for the FormField component.
 */
export interface FormFieldProps {
  /** Field label text */
  label: string;
  /** Input field name (used for form data) */
  name: string;
  /** Current field value */
  value: string;
  /** Change handler */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  /** Input type (text, email, password, date) */
  type?: 'text' | 'email' | 'password' | 'date';
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Minimum length for text inputs */
  minLength?: number;
  /** Maximum date value (for date inputs) */
  max?: string;
}

/**
 * Reusable form input field with label.
 * Provides consistent styling for text, email, password, and date inputs.
 * @param props - FormField props
 * @returns Form field element with label and input
 */
export function FormField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  minLength,
  max,
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="input"
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        max={max}
      />
    </div>
  );
}

/**
 * Props for the SelectField component.
 */
export interface SelectFieldProps {
  /** Field label text */
  label: string;
  /** Select field name */
  name: string;
  /** Current selected value */
  value: string;
  /** Change handler */
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Select options */
  options: Array<{ value: string; label: string }>;
  /** Whether the field is required */
  required?: boolean;
}

/**
 * Reusable select field with label.
 * @param props - SelectField props
 * @returns Select field element with label and options
 */
export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  required,
}: SelectFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="input"
        required={required}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Props for the TextareaField component.
 */
export interface TextareaFieldProps {
  /** Field label text */
  label: string;
  /** Textarea field name */
  name: string;
  /** Current field value */
  value: string;
  /** Change handler */
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Number of visible rows */
  rows?: number;
}

/**
 * Reusable textarea field with label.
 * @param props - TextareaField props
 * @returns Textarea field element with label
 */
export function TextareaField({
  label,
  name,
  value,
  onChange,
  placeholder,
  rows = 3,
}: TextareaFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        name={name}
        value={value}
        onChange={onChange}
        className="input resize-none"
        rows={rows}
        placeholder={placeholder}
      />
    </div>
  );
}

/**
 * Props for the EditableField component (used in profile editing).
 */
export interface EditableFieldProps {
  /** Field label text */
  label: string;
  /** Field name for form data */
  name: string;
  /** Current value when editing */
  editValue: string;
  /** Display value when not editing */
  displayValue: string;
  /** Placeholder when display value is empty */
  emptyPlaceholder?: string;
  /** Whether currently in edit mode */
  isEditing: boolean;
  /** Change handler for edit mode */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Whether this is a textarea (multi-line) */
  multiline?: boolean;
}

/**
 * Editable profile field component.
 * Shows read-only text when not editing, input when editing.
 * @param props - EditableField props
 * @returns Editable field element
 */
export function EditableField({
  label,
  name,
  editValue,
  displayValue,
  emptyPlaceholder = 'Not set',
  isEditing,
  onChange,
  multiline = false,
}: EditableFieldProps) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      {isEditing ? (
        multiline ? (
          <textarea
            name={name}
            value={editValue}
            onChange={onChange}
            className="input resize-none"
            rows={3}
          />
        ) : (
          <input
            type="text"
            name={name}
            value={editValue}
            onChange={onChange}
            className="input"
          />
        )
      ) : (
        <p className="text-gray-900">{displayValue || emptyPlaceholder}</p>
      )}
    </div>
  );
}
