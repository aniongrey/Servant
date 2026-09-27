import { useId, useMemo, useState, type ReactNode } from 'react';
import { Check, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';

/**
 * The list shell shared by the two asset libraries of the settings window: the
 * VRM model library (角色设置) and the voice library (语音设置).
 *
 * They are the same surface — a searchable list of named things where one row is
 * the active one, and a row can be renamed or deleted — so the markup and the
 * `.aurelia-asset-library*` styles live here once. What differs is only what a
 * row *is*: the caller supplies the icon, the secondary line, which rows can be
 * deleted, and the fields of the inline editor.
 */
export interface AssetLibraryItem {
  id: string;
  /** Shown text: the alias when the user set one, the original name otherwise. */
  name: string;
  /** Secondary line under the name (source, size, model…). */
  meta?: string;
  /** Text the search box matches but the row never shows (the original name). */
  keywords?: string;
  active?: boolean;
  /** Whether the name differs from the original, i.e. "恢复原名" applies. */
  renamed?: boolean;
  /** Defaults to `true`; set `false` to keep an internal row out of the trash. */
  removable?: boolean;
  icon?: ReactNode;
}

export interface AssetEditorField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  /**
   * Turns the field into a `<select>` of these ids.
   *
   * Used where the value is not free text but a pick from a list the caller owns
   * (a GPT-SoVITS role id); the caller is responsible for including the current
   * value, otherwise the browser would fall back to the first option.
   */
  options?: readonly AssetEditorOption[];
  /**
   * Offers these ids as autocomplete on a free-text input.
   *
   * The counterpart of {@link options} for values the user *may* type their own
   * version of (a provider's preset voices plus a private Voice ID), where a
   * `<select>` would make everything outside the list unreachable.
   */
  suggestions?: readonly AssetEditorOption[];
}

export interface AssetEditorOption {
  id: string;
  label: string;
}

export const ASSET_NAME_MAX_LENGTH = 40;

export function AssetFieldEditor({
  fields,
  saveLabel = '保存',
  onSave,
  onCancel
}: {
  fields: readonly AssetEditorField[];
  saveLabel?: string;
  onSave(values: Record<string, string>): void;
  onCancel(): void;
}) {
  // Seeded once from `fields`: give this component a `key` per edited row, or
  // editing another row would keep the previous draft.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value]))
  );
  // A field's datalist needs an id that is unique on the page, and this form can
  // be rendered once per row.
  const suggestionListId = useId();
  const incomplete = fields.some((field) => !draft[field.key]?.trim());
  const submit = () => {
    if (!incomplete) onSave(draft);
  };
  const setValue = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="aurelia-asset-editor">
      <div className="aurelia-asset-editor-fields">
        {fields.map((field) => (
          <label className="aurelia-field" key={field.key}>
            <span>{field.label}</span>
            {field.options ? (
              <select
                value={draft[field.key] ?? ''}
                onChange={(event) => setValue(field.key, event.currentTarget.value)}
              >
                {field.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  autoComplete="off"
                  list={field.suggestions ? `${suggestionListId}-${field.key}` : undefined}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  value={draft[field.key] ?? ''}
                  onChange={(event) => setValue(field.key, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancel();
                    }
                  }}
                />
                {field.suggestions ? (
                  <datalist id={`${suggestionListId}-${field.key}`}>
                    {field.suggestions.map((option) => (
                      <option key={option.id} label={option.label} value={option.id} />
                    ))}
                  </datalist>
                ) : null}
              </>
            )}
          </label>
        ))}
      </div>
      <div className="aurelia-asset-editor-actions">
        <button disabled={incomplete} onClick={submit} type="button">
          <Check size={13} /> {saveLabel}
        </button>
        <button onClick={onCancel} type="button">
          <X size={13} /> 取消
        </button>
      </div>
    </div>
  );
}

export function AssetLibrary({
  heading,
  summary,
  emptyText,
  searchPlaceholder,
  items,
  onSelect,
  editorFields,
  onEdit,
  onResetName,
  onDelete
}: {
  heading: string;
  summary: string;
  emptyText: string;
  searchPlaceholder: string;
  items: readonly AssetLibraryItem[];
  /** Callbacks take ids, never item objects: the caller owns the real records. */
  onSelect(id: string): void;
  /** Enables the rename action; pair it with {@link editorFields}. */
  editorFields?: (item: AssetLibraryItem) => readonly AssetEditorField[];
  onEdit?(id: string, values: Record<string, string>): void;
  onResetName?(id: string): void;
  onDelete?(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.name, item.keywords ?? '', item.meta ?? ''].some((text) => text.toLowerCase().includes(needle))
    );
  }, [items, query]);

  return (
    <div className="aurelia-asset-library">
      <div className="aurelia-asset-library-heading">
        <span>{heading}</span>
        <small>{summary}</small>
      </div>
      {items.length > 0 ? (
        <label className="aurelia-action-search aurelia-asset-search">
          <Search size={14} />
          <input
            aria-label={searchPlaceholder}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            value={query}
          />
        </label>
      ) : null}
      {items.length === 0 ? <p>{emptyText}</p> : null}
      {items.length > 0 && visible.length === 0 ? <p>没有匹配的名称。</p> : null}
      {visible.map((item) => {
        const fields = editorFields?.(item);
        if (editingId === item.id && fields && onEdit) {
          return (
            <div className="aurelia-asset-library-row" data-active={item.active === true} key={item.id}>
              <AssetFieldEditor
                fields={fields}
                key={`${item.id}:editor`}
                onCancel={() => setEditingId(null)}
                onSave={(values) => {
                  onEdit(item.id, values);
                  setEditingId(null);
                }}
              />
            </div>
          );
        }
        return (
          <div className="aurelia-asset-library-row" data-active={item.active === true} key={item.id}>
            <button className="aurelia-asset-library-main" onClick={() => onSelect(item.id)} type="button">
              {item.icon}
              <span className="aurelia-asset-library-copy">
                <span className="aurelia-asset-library-name">{item.name}</span>
                {item.meta ? <small>{item.meta}</small> : null}
              </span>
            </button>
            <div className="aurelia-asset-library-actions">
              {fields && onEdit ? (
                <button
                  aria-label={`重命名 ${item.name}`}
                  className="aurelia-icon-action"
                  onClick={() => setEditingId(item.id)}
                  title="重命名"
                  type="button"
                >
                  <Pencil size={13} />
                </button>
              ) : null}
              {onResetName && item.renamed ? (
                <button
                  aria-label={`恢复 ${item.name} 的原名`}
                  className="aurelia-icon-action"
                  onClick={() => onResetName(item.id)}
                  title="恢复原名"
                  type="button"
                >
                  <RotateCcw size={13} />
                </button>
              ) : null}
              {onDelete && item.removable !== false ? (
                <button
                  aria-label={`删除 ${item.name}`}
                  className="aurelia-danger-icon"
                  onClick={() => onDelete(item.id)}
                  title="删除"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
