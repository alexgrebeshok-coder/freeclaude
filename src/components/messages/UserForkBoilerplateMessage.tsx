import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import figures from 'figures'
import React from 'react'
import {
  FORK_BOILERPLATE_TAG,
  FORK_DIRECTIVE_PREFIX,
} from '../../constants/xml.js'
import { Box, Text } from '../../ink.js'
import { extractTag } from '../../utils/messages.js'

interface Props {
  addMargin?: boolean
  param?: TextBlockParam
}

export const UserForkBoilerplateMessage: React.FC<Props> = ({ addMargin, param }) => {
  const text = param?.text ?? ''
  const boilerplate = extractTag(text, FORK_BOILERPLATE_TAG)
  if (!boilerplate) {
    return null
  }

  const directiveStart = text.lastIndexOf(FORK_DIRECTIVE_PREFIX)
  const directive =
    directiveStart >= 0
      ? text.slice(directiveStart + FORK_DIRECTIVE_PREFIX.length).trim()
      : boilerplate.trim()

  return (
    <Box
      flexDirection="column"
      marginTop={addMargin ? 1 : 0}
      backgroundColor="userMessageBackground"
      paddingRight={1}
    >
      <Text>
        <Text color="subtle">{figures.pointer} </Text>
        <Text color="text">{directive ? `/fork ${directive}` : '/fork'}</Text>
      </Text>
    </Box>
  )
}
