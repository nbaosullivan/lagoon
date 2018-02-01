// @flow

import { green, blue } from 'chalk';
import inquirer from 'inquirer';
import R from 'ramda';
import { table } from 'table';
import urlRegex from 'url-regex';

import gql from '../../gql';
import { printGraphQLErrors } from '../../printErrors';
import { runGQLQuery } from '../../query';

import typeof Yargs from 'yargs';
import type { BaseArgs } from '..';

export const command = 'create';
export const description = 'Create new project';

export function builder(yargs: Yargs): Yargs {
  return yargs
    .usage(`$0 ${command} - ${description}`)
    .example('$0', 'Create new project');
}

type createProjectArgs = {
  clog: typeof console.log,
  cerr: typeof console.error,
};

export async function createProject({
  clog,
  cerr,
}:
createProjectArgs): Promise<number> {
  const customersAndOpenshiftsResults = await runGQLQuery({
    query: gql`
      query AllCustomersAndOpenshiftsForProjectCreate {
        allCustomers {
          value: id
          name
        }
        allOpenshifts {
          value: id
          name
        }
      }
    `,
    cerr,
  });

  const { errors } = customersAndOpenshiftsResults;
  if (errors != null) {
    return printGraphQLErrors(cerr, ...errors);
  }

  const allCustomers = R.path(
    ['data', 'allCustomers'],
    customersAndOpenshiftsResults,
  );
  const allOpenshifts = R.path(
    ['data', 'allOpenshifts'],
    customersAndOpenshiftsResults,
  );

  const projectInput = await inquirer.prompt([
    {
      type: 'list',
      name: 'customer',
      message: 'Customer:',
      choices: allCustomers,
      // Using the `when` method of the question object, decide whether to skip the question and trigger some side effects based on the number of customers returned
      // https://github.com/SBoudrias/Inquirer.js/issues/517#issuecomment-288964496
      when(answers) {
        return R.ifElse(
          R.compose(R.gte(1), R.length),
          // If there is only one customer in the customers list, use that customer as the answer to the question and tell the user, not prompting them to choose.
          (customers) => {
            const firstCustomer = R.head(customers);
            clog(`${blue('!')} Using only authorized customer "${R.prop(
              'name',
              firstCustomer,
            )}"`);
            // eslint-disable-next-line no-param-reassign
            answers.customer = R.prop('value', firstCustomer);
          },
          // If there is more than one customer, return true in order to trigger the list prompt
          R.T,
        )(allCustomers);
      },
    },
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      validate: input => Boolean(input) || 'Please enter a project name.',
    },
    {
      type: 'input',
      name: 'git_url',
      message: 'Git URL:',
      validate: input =>
        // Verify that it is a valid URL and...
        (urlRegex({ exact: true }).test(input) &&
          // ...that it is either a URL from the big three git hosts or includes `.git` at the end of the string.
          /(github\.com|bitbucket\.org|gitlab\.com|\.git$)/.test(input)) ||
        // If the input is invalid, prompt the user to enter a valid Git URL
        'Please enter a valid Git URL.',
    },
    {
      type: 'list',
      name: 'openshift',
      message: 'Openshift:',
      choices: allOpenshifts,
      // Using the `when` method of the question object, decide whether to skip the question and trigger some side effects based on the number of openshifts returned
      // https://github.com/SBoudrias/Inquirer.js/issues/517#issuecomment-288964496
      when(answers) {
        return R.ifElse(
          R.compose(R.gte(1), R.length),
          // If there is only one openshift in the openshifts list, use that openshift as the answer to the question and tell the user, not prompting them to choose.
          (openshifts) => {
            const firstOpenshift = R.head(openshifts);
            clog(`${blue('!')} Using only authorized openshift "${R.prop(
              'name',
              firstOpenshift,
            )}"`);
            // eslint-disable-next-line no-param-reassign
            answers.openshift = R.prop('value', firstOpenshift);
          },
          // If there is more than one openshift, return true in order to trigger the list prompt
          R.T,
        )(allOpenshifts);
      },
    },
    {
      type: 'input',
      name: 'active_systems_deploy',
      message: 'Active system for task "deploy":',
      default: 'lagoon_openshiftBuildDeploy',
    },
    {
      type: 'input',
      name: 'active_systems_remove',
      message: 'Active system for task "remove":',
      default: 'lagoon_openshiftRemove',
    },
    {
      type: 'input',
      name: 'branches',
      message: 'Deploy branches:',
      default: 'true',
    },
    {
      type: 'input',
      name: 'pullrequests',
      message: 'Pull requests:',
      default: null,
    },
    {
      type: 'input',
      name: 'production_environment',
      message: 'Production environment:',
      default: null,
    },
  ]);

  const addProjectResult = await runGQLQuery({
    query: gql`
      mutation AddProject($input: ProjectInput!) {
        addProject(input: $input) {
          id
          name
          customer {
            name
          }
          git_url
          active_systems_deploy
          active_systems_remove
          branches
          pullrequests
          openshift {
            name
          }
          created
        }
      }
    `,
    cerr,
    variables: {
      input: projectInput,
    },
  });

  const { errors: addProjectErrors } = addProjectResult;
  if (addProjectErrors != null) {
    return printGraphQLErrors(cerr, ...addProjectErrors);
  }

  const project = R.path(['data', 'addProject'], addProjectResult);

  const projectName = R.prop('name', project);

  clog(green(`Project "${projectName}" created successfully:`));

  clog(table([
    ['Project Name', projectName],
    ['Customer', R.path(['customer', 'name'], project)],
    ['Git URL', R.prop('git_url', project)],
    ['Active Systems Deploy', R.prop('active_systems_deploy', project)],
    ['Active Systems Remove', R.prop('active_systems_remove', project)],
    ['Branches', String(R.prop('branches', project))],
    ['Pull Requests', String(R.prop('pullrequests', project))],
    ['Openshift', R.path(['openshift', 'name'], project)],
    ['Created', R.path(['created'], project)],
  ]));

  return 0;
}

export async function handler({
  clog,
  cerr,
  config,
}:
BaseArgs): Promise<number> {
  return createProject({ clog, cerr });
}
