import { styled } from '@mui/material/styles';

import { IPreferences } from '@services/preferences/interface';

const Avatar = styled('div')`
  display: inline-block;
  height: 32px;
  width: 32px;
  background-color: ${({ theme }) => theme.palette.background.default};
  border-radius: 4;
  color: ${({ theme }) => theme.palette.text.primary};
  line-height: 32px;
  text-align: center;
  font-weight: 500;
  text-transform: uppercase;
  margin-left: 10px;
  margin-right: 10px;
`;

const GuideContainer = styled('div')`
  cursor: pointer;
  user-select: none;
  text-align: center;
  padding: 20px;
`;

export interface IProps {
  sidebar: IPreferences['sidebar'];
  themeSource: IPreferences['themeSource'];
}

export function NewUserMessage(props: IProps): React.JSX.Element {
  void props;
  return (
    <GuideContainer id='new-user-tip'>
      <p>Welcome to Memeloop - Your AI-Powered Desktop Agent</p>
    </GuideContainer>
  );
}
