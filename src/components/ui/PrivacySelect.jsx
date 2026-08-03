import React from 'react';

export default function PrivacySelect({
  label,
  description,
  value,
  options = [],
  onChange,
  disabled = false,
  className = '',
}) {
  return (
    <div className={`privacy-select-group ${className}`.trim()}>
      <div className="privacy-select-header">
        <label className="privacy-select-label">{label}</label>
        {description && <span className="privacy-select-description">{description}</span>}
      </div>
      <div className="privacy-select-options" role="radiogroup" aria-label={label}>
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`privacy-select-option ${isSelected ? 'selected' : ''}`}
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => !disabled && onChange?.(opt.value)}
            >
              <span className="privacy-select-dot" aria-hidden="true" />
              <span className="privacy-select-option-label">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
