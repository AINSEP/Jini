export function FormEditorHeaderText(props: { isNew: boolean; name: string; t: (key: string) => string }, _optional: Record<string, never> = {}) {
  const { isNew, name, t } = props;
  return (
    <div className="page-header-text">
      <p className="page-kicker">{t("Content")}</p>
      <h1 className="page-title">{isNew ? t("New form") : name || t("Form")}</h1>
      <p className="page-description">
        {isNew
          ? t("Configure a new form's fields and email notifications.")
          : t("Configure this form's fields and notifications, or review its submissions.")}
      </p>
    </div>
  );
}

/** The Fields/Submissions tab strip — renders only for an existing, loaded form (`showTabs`). */
