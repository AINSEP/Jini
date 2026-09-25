import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card.js';

export interface ContentCardProps {
  readonly title?: string;
  readonly description?: string;
  readonly content?: string;
}

export function ContentCard({ title, description, content }: ContentCardProps) {
  return (
    <Card>
      {title || description ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      {content ? <CardContent>{content}</CardContent> : null}
    </Card>
  );
}
