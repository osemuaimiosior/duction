#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __APPLE__
#include <OpenCL/opencl.h>
#else
#include <CL/cl.h>
#endif

#define MAX_SOURCE_SIZE 0x100000

int main()
{
    cl_device_id device_id;
    cl_context context;
    cl_command_queue command_queue;
    cl_program program;
    cl_kernel kernel;
    cl_platform_id platform_id;
    cl_uint ret_num_devices;
    cl_uint ret_num_platforms;
    cl_int ret;

    FILE *fp;
    char fileName[] = "./kernel.cl";
    char *source_str;
    size_t source_size;

    /* Load kernel source */
    fp = fopen(fileName, "r");
    if (!fp) {
        printf("Failed to load kernel.\n");
        return 1;
    }

    source_str = (char *)malloc(MAX_SOURCE_SIZE);
    source_size = fread(source_str, 1, MAX_SOURCE_SIZE, fp);
    fclose(fp);

    /* Platform + Device */
    clGetPlatformIDs(1, &platform_id, &ret_num_platforms);
    clGetDeviceIDs(platform_id, CL_DEVICE_TYPE_GPU, 1, &device_id, &ret_num_devices);

    /* Context */
    context = clCreateContext(NULL, 1, &device_id, NULL, NULL, &ret);

    /* Command queue */
    command_queue = clCreateCommandQueue(context, device_id, 0, &ret);

    /* Program */
    program = clCreateProgramWithSource(context, 1,
                                        (const char **)&source_str,
                                        &source_size, &ret);

    clBuildProgram(program, 1, &device_id, NULL, NULL, NULL);

    /* Kernel */
    kernel = clCreateKernel(program, "monteCarloOption", &ret);

    printf("MC Engine Ready\n");
    fflush(stdout);

    /* Persistent worker loop */
    while (1)
    {
        char input[256];

        if (!fgets(input, sizeof(input), stdin))
            break;

        int runs;
        float S0, K, r, sigma, T;

        sscanf(input, "%d %f %f %f %f %f",
               &runs, &S0, &K, &r, &sigma, &T);

        cl_mem memobj = clCreateBuffer(
            context,
            CL_MEM_WRITE_ONLY,
            runs * sizeof(float),
            NULL,
            &ret
        );

        /* Set kernel arguments */
        clSetKernelArg(kernel, 0, sizeof(float), &S0);
        clSetKernelArg(kernel, 1, sizeof(float), &K);
        clSetKernelArg(kernel, 2, sizeof(float), &r);
        clSetKernelArg(kernel, 3, sizeof(float), &sigma);
        clSetKernelArg(kernel, 4, sizeof(float), &T);
        clSetKernelArg(kernel, 5, sizeof(int), &runs);
        clSetKernelArg(kernel, 6, sizeof(cl_mem), &memobj);

        size_t global_size = runs;

        clEnqueueNDRangeKernel(
            command_queue,
            kernel,
            1,
            NULL,
            &global_size,
            NULL,
            0,
            NULL,
            NULL
        );

        float *results = (float*)malloc(sizeof(float) * runs);

        clEnqueueReadBuffer(
            command_queue,
            memobj,
            CL_TRUE,
            0,
            runs * sizeof(float),
            results,
            0,
            NULL,
            NULL
        );

        double sum = 0;

        for(int i = 0; i < runs; i++)
            sum += results[i];

        float price = sum / runs;

        /* Send result to Node.js */
        printf("%f\n", price);
        fflush(stdout);

        clReleaseMemObject(memobj);
        free(results);
    }

    /* Cleanup */
    clReleaseKernel(kernel);
    clReleaseProgram(program);
    clReleaseCommandQueue(command_queue);
    clReleaseContext(context);

    free(source_str);

    return 0;
}