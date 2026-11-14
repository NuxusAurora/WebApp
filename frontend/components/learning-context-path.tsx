import { Fragment } from 'react';
import { Icon } from './icon';
import { Breadcrumb } from './ui';

export function LearningContextPath({ labels }: { labels: (string | undefined)[] }) {
  const path = labels.filter((label): label is string => Boolean(label));
  if (!path.length) return null;
  return <div className="learning-context-path">
    <Breadcrumb>
      {path.map((label, index) => <Fragment key={index}>
        {index ? <Icon name="chevron" size={12} /> : null}
        <span title={label}>{label}</span>
      </Fragment>)}
    </Breadcrumb>
  </div>;
}
