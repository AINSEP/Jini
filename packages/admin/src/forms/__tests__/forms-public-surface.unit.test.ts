import { describe, expect, it } from 'vitest';
import * as forms from '../index.js';

describe('@jini-ai/admin/forms public surface', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(forms).sort()).toEqual([
      'ATTRIBUTE_NAME_PATTERN', 'ATTRIBUTE_NAME_SUGGESTIONS', 'FORMS_LIST_RESOURCE', 'FORM_TABS', 'KEYS',
      'MAX_ATTRIBUTES_PER_FIELD', 'MAX_CLASS_NAME_LENGTH', 'addAttrRow', 'addFormField', 'attrRowsFromField', 'blankField',
      'buildFieldAttributesPatch', 'createFieldAttributesDialogController', 'createFormEditorController',
      'createFormFieldsEditorController', 'createFormSubmissionDetailController', 'createFormSubmissionsController',
      'createFormsListController', 'describeTrashError', 'existingFieldIdsOf', 'fieldDisplayName', 'formAnswerColumns',
      'formAnswerFile', 'formDateDisplay', 'formDatesLines', 'formHtmlEmbed', 'formHtmlStarter', 'formRowMenuItems',
      'formSubmissionRows', 'formatFormAnswer', 'formsApiToken', 'formsCatalogToken', 'formsEventsToken', 'formsListError', 'formsMessagesEn',
      'formsModule', 'formsNavigationToken', 'formsTrashToken', 'newestUpdatedForms', 'nextTabIndex', 'removeAttrRow',
      'removeFormField', 'replaceFormField', 'translateForms', 'updateAttrRow', 'updateFormField', 'visibleFormEditorError',
    ]);
  });
});
