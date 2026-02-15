export interface ComponentPropSchema {
  name: string;
  type: string;
  label: string;
  bindable?: boolean;
}

export interface ComponentDefinition {
  type: string;
  label: string;
  icon: string;
  category: string;
  defaultProps: Record<string, unknown>;
  propSchema: ComponentPropSchema[];
}

export const componentRegistry: ComponentDefinition[] = [
  {
    type: 'table',
    label: 'Table',
    icon: 'table',
    category: 'Data Display',
    defaultProps: {
      data: '{{ query1.data }}',
      columns: [],
      pageSize: 10,
      searchable: true,
    },
    propSchema: [
      { name: 'data', type: 'binding', label: 'Data Source', bindable: true },
      { name: 'columns', type: 'json', label: 'Columns' },
      { name: 'pageSize', type: 'number', label: 'Page Size' },
      { name: 'searchable', type: 'boolean', label: 'Searchable' },
    ],
  },
  {
    type: 'textInput',
    label: 'Text Input',
    icon: 'text-input',
    category: 'Inputs',
    defaultProps: {
      label: 'Text Input',
      placeholder: 'Enter text...',
      defaultValue: '',
    },
    propSchema: [
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'placeholder', type: 'string', label: 'Placeholder' },
      { name: 'defaultValue', type: 'string', label: 'Default Value', bindable: true },
    ],
  },
  {
    type: 'button',
    label: 'Button',
    icon: 'button',
    category: 'Actions',
    defaultProps: {
      label: 'Click',
      onClick: '',
      variant: 'primary',
      disabled: false,
    },
    propSchema: [
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'onClick', type: 'action', label: 'On Click' },
      { name: 'variant', type: 'select', label: 'Variant' },
      { name: 'disabled', type: 'boolean', label: 'Disabled' },
    ],
  },
  {
    type: 'text',
    label: 'Text',
    icon: 'text',
    category: 'Data Display',
    defaultProps: {
      value: 'Text content',
      fontSize: 14,
      fontWeight: 'normal',
      color: '#1C1C1E',
    },
    propSchema: [
      { name: 'value', type: 'string', label: 'Value', bindable: true },
      { name: 'fontSize', type: 'number', label: 'Font Size' },
      { name: 'fontWeight', type: 'select', label: 'Font Weight' },
      { name: 'color', type: 'color', label: 'Color' },
    ],
  },
  {
    type: 'numberInput',
    label: 'Number Input',
    icon: 'number-input',
    category: 'Inputs',
    defaultProps: {
      label: 'Number',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 0,
    },
    propSchema: [
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'min', type: 'number', label: 'Min' },
      { name: 'max', type: 'number', label: 'Max' },
      { name: 'step', type: 'number', label: 'Step' },
      { name: 'defaultValue', type: 'number', label: 'Default Value' },
    ],
  },
  {
    type: 'select',
    label: 'Select',
    icon: 'select',
    category: 'Inputs',
    defaultProps: {
      label: 'Select',
      options: [],
      value: '',
      placeholder: 'Choose an option...',
    },
    propSchema: [
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'options', type: 'json', label: 'Options', bindable: true },
      { name: 'value', type: 'string', label: 'Value', bindable: true },
      { name: 'placeholder', type: 'string', label: 'Placeholder' },
    ],
  },
  {
    type: 'chart',
    label: 'Chart',
    icon: 'chart',
    category: 'Data Display',
    defaultProps: {
      type: 'bar',
      data: '{{ query1.data }}',
      xKey: '',
      yKey: '',
      title: '',
    },
    propSchema: [
      { name: 'type', type: 'select', label: 'Chart Type' },
      { name: 'data', type: 'binding', label: 'Data Source', bindable: true },
      { name: 'xKey', type: 'string', label: 'X Axis Key' },
      { name: 'yKey', type: 'string', label: 'Y Axis Key' },
      { name: 'title', type: 'string', label: 'Title' },
    ],
  },
  {
    type: 'form',
    label: 'Form',
    icon: 'form',
    category: 'Layout',
    defaultProps: {
      submitLabel: 'Submit',
      onSubmit: '',
    },
    propSchema: [
      { name: 'submitLabel', type: 'string', label: 'Submit Label' },
      { name: 'onSubmit', type: 'action', label: 'On Submit' },
    ],
  },
  {
    type: 'container',
    label: 'Container',
    icon: 'container',
    category: 'Layout',
    defaultProps: {
      backgroundColor: '#FFFFFF',
      padding: 16,
      borderRadius: 8,
    },
    propSchema: [
      { name: 'backgroundColor', type: 'color', label: 'Background Color' },
      { name: 'padding', type: 'number', label: 'Padding' },
      { name: 'borderRadius', type: 'number', label: 'Border Radius' },
    ],
  },
];

export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return componentRegistry.find((c) => c.type === type);
}
