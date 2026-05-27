import { styled } from '@mui/material/styles';
import React from 'react';

const InnerContentRoot = styled('div')`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px;
  width: 100%;
  height: 100%;
`;

export default function Guide(): React.JSX.Element {
  return (
    <InnerContentRoot>
      <p>Welcome to Memeloop</p>
    </InnerContentRoot>
  );
}
