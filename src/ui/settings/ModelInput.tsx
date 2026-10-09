import { Autocomplete } from '@mantine/core';

export interface ModelSuggestion {
  id: string;
  label: string;
}

export function rankModelSuggestions<T extends ModelSuggestion>(models: readonly T[], value: string): T[] {
  const query = value.trim().toLowerCase();
  const rank = (model: T) => {
    const names = [model.id.toLowerCase(), model.label.toLowerCase()];
    if (names.some((name) => name === query)) return 0;
    if (names.some((name) => name.startsWith(query))) return 1;
    if (names.some((name) => name.includes(query))) return 2;
    return 3;
  };
  return [...models].sort((left, right) => rank(left) - rank(right));
}

export function ModelInput({
  models,
  value,
  onChange,
  placeholder,
  label
}: {
  models: readonly ModelSuggestion[];
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  label: string;
}) {
  return (
    <Autocomplete
      aria-label={label}
      autoComplete="off"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      data={rankModelSuggestions(models, value).map((model) => model.id)}
      filter={({ options }) => options}
      styles={{ dropdown: { color: 'var(--mantine-color-text)' } }}
      openOnFocus
      renderOption={({ option }) => {
        const model = models.find((model) => model.id === option.value);
        return model && model.label !== model.id ? `${model.label} · ${model.id}` : option.value;
      }}
    />
  );
}
