import type { Schema, Struct } from '@strapi/strapi';

export interface LessonNoteSection extends Struct.ComponentSchema {
  collectionName: 'components_lesson_note_sections';
  info: {
    description: "One section of a lesson's notes.";
    displayName: 'Note section';
    icon: 'file';
  };
  attributes: {
    content: Schema.Attribute.RichText & Schema.Attribute.Required;
    image: Schema.Attribute.Media<'images'>;
    imageUrl: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    order: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    sectionType: Schema.Attribute.Enumeration<
      ['text', 'tip', 'phase', 'html', 'image']
    > &
      Schema.Attribute.DefaultTo<'text'>;
    title: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
  };
}

export interface LessonResource extends Struct.ComponentSchema {
  collectionName: 'components_lesson_resources';
  info: {
    description: 'A downloadable PDF attached to a lesson. PDF-only is enforced in src/pdf-only.ts.';
    displayName: 'Resource (PDF)';
    icon: 'attachment';
  };
  attributes: {
    color: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 100;
      }>;
    externalUrl: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    file: Schema.Attribute.Media<'files'>;
    fileSize: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 50;
      }>;
    fileType: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 50;
      }> &
      Schema.Attribute.DefaultTo<'PDF'>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
  };
}

export interface QuizOption extends Struct.ComponentSchema {
  collectionName: 'components_quiz_options';
  info: {
    description: 'One answer option for a question.';
    displayName: 'Option';
    icon: 'bulletList';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'>;
    isCorrect: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    text: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface QuizQuestion extends Struct.ComponentSchema {
  collectionName: 'components_quiz_questions';
  info: {
    description: 'A quiz question with its answer options.';
    displayName: 'Question';
    icon: 'question';
  };
  attributes: {
    explanation: Schema.Attribute.RichText;
    image: Schema.Attribute.Media<'images'>;
    options: Schema.Attribute.Component<'quiz.option', true>;
    order: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    points: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<1>;
    text: Schema.Attribute.RichText & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<['mcq', 'essay', 'short_answer']> &
      Schema.Attribute.DefaultTo<'mcq'>;
    unitName: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 150;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'lesson.note-section': LessonNoteSection;
      'lesson.resource': LessonResource;
      'quiz.option': QuizOption;
      'quiz.question': QuizQuestion;
    }
  }
}
